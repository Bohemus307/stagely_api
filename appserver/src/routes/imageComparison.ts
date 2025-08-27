import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  RekognitionClient,
  DetectLabelsCommand,
  Label,
  RekognitionServiceException,
} from "@aws-sdk/client-rekognition";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import "dotenv/config";
import sharp from "sharp";
import crypto from "crypto";

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
});

interface RoomComparisonRequest {
  sourceImageUrl: string;
  targetImageUrl: string;
  includeDebugInfo?: boolean; // Optional flag to include debug information
}

interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DetectedObject {
  name: string;
  confidence: number;
  boundingBox: BoundingBox;
}

interface RoomComparisonResponse {
  addedObjects: DetectedObject[];
  removedObjects: DetectedObject[];
  commonObjects: {
    source: DetectedObject;
    target: DetectedObject;
  }[];
  comparisonImageUrl: string;
  summary: {
    totalAdded: number;
    totalRemoved: number;
    totalUnchanged: number;
  };
  debugInfo?: {
    totalSourceLabels: number;
    totalTargetLabels: number;
    sourceLabelsWithBoxes: number;
    targetLabelsWithBoxes: number;
    excludedLabels: string[];
  };
}

interface ErrorResponse {
  error: string;
}

// Extend FastifyInstance to include S3 decorator
declare module "fastify" {
  interface FastifyInstance {
    s3: {
      client: S3Client;
      bucket: string;
      region: string;
    };
  }
}

// Define your JSON schema for validation using Fastify's schema format
const schema = {
  body: {
    type: "object",
    required: ["sourceImageUrl", "targetImageUrl"],
    properties: {
      sourceImageUrl: { type: "string" },
      targetImageUrl: { type: "string" },
      includeDebugInfo: { type: "boolean" },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        addedObjects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              confidence: { type: "number" },
              boundingBox: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
              },
            },
          },
        },
        removedObjects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              confidence: { type: "number" },
              boundingBox: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
              },
            },
          },
        },
        commonObjects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  confidence: { type: "number" },
                  boundingBox: {
                    type: "object",
                    properties: {
                      left: { type: "number" },
                      top: { type: "number" },
                      width: { type: "number" },
                      height: { type: "number" },
                    },
                  },
                },
              },
              target: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  confidence: { type: "number" },
                  boundingBox: {
                    type: "object",
                    properties: {
                      left: { type: "number" },
                      top: { type: "number" },
                      width: { type: "number" },
                      height: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
        comparisonImageUrl: { type: "string" },
        summary: {
          type: "object",
          properties: {
            totalAdded: { type: "number" },
            totalRemoved: { type: "number" },
            totalUnchanged: { type: "number" },
          },
        },
        debugInfo: {
          type: "object",
          properties: {
            totalSourceLabels: { type: "number" },
            totalTargetLabels: { type: "number" },
            sourceLabelsWithBoxes: { type: "number" },
            targetLabelsWithBoxes: { type: "number" },
            excludedLabels: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
    400: {
      type: "object",
      properties: {
        error: { type: "string" },
      },
    },
    500: {
      type: "object",
      properties: {
        error: { type: "string" },
      },
    },
  },
};

// Configuration constants
const MIN_BOUNDING_BOX_SIZE = 0.01; // Minimum 1% of image width/height
const MIN_CONFIDENCE = 70; // Minimum confidence for detection
const MAX_LABELS = 100; // Maximum labels to request from Rekognition
const IOU_THRESHOLD = 0.3; // Intersection over Union threshold for matching objects

// List of generic scene-level labels to exclude
const EXCLUDED_LABELS = [
  "Indoors",
  "Outdoors",
  "Interior Design",
  "Room",
  "Floor",
  "Ceiling",
  "Wall",
  "Building",
  "Architecture",
  "House",
  "Home Decor",
  "Flooring",
  "Wood",
  "Hardwood",
  "Living Room",
  "Bedroom",
  "Kitchen",
  "Bathroom",
  "Dining Room",
  "Office",
  "Furniture",
  "Nature",
  "Urban",
  "City",
];

async function detectLabels(image: Buffer) {
  try {
    const command = new DetectLabelsCommand({
      Image: { Bytes: image },
      MinConfidence: MIN_CONFIDENCE,
      MaxLabels: MAX_LABELS,
    });
    return rekognitionClient.send(command);
  } catch (error) {
    if (error instanceof RekognitionServiceException) {
      throw new Error(`Rekognition error: ${error.message}`);
    }
    throw error;
  }
}

function convertToDetectedObjects(label: Label): DetectedObject[] {
  // Skip generic labels
  if (EXCLUDED_LABELS.includes(label.Name || "")) {
    return [];
  }

  // Only process labels that have actual object instances with bounding boxes
  if (!label.Instances || label.Instances.length === 0) {
    return [];
  }

  // Convert each instance to a detected object
  return label.Instances.filter((instance) => {
    // Must have a valid bounding box with non-zero dimensions
    const box = instance.BoundingBox;
    return (
      box &&
      box.Width &&
      box.Width > MIN_BOUNDING_BOX_SIZE &&
      box.Height &&
      box.Height > MIN_BOUNDING_BOX_SIZE
    );
  }).map((instance) => ({
    name: label.Name || "",
    confidence: instance.Confidence || label.Confidence || 0,
    boundingBox: {
      left: instance.BoundingBox?.Left || 0,
      top: instance.BoundingBox?.Top || 0,
      width: instance.BoundingBox?.Width || 0,
      height: instance.BoundingBox?.Height || 0,
    },
  }));
}

function compareRooms(
  sourceLabels: Label[],
  targetLabels: Label[],
): Omit<RoomComparisonResponse, "comparisonImageUrl"> {
  // Convert labels to detected objects, filtering out non-instance labels
  const sourceObjects = sourceLabels.flatMap(convertToDetectedObjects);
  const targetObjects = targetLabels.flatMap(convertToDetectedObjects);

  // Group objects by name and location for better matching
  const findSimilarObject = (
    obj: DetectedObject,
    objects: DetectedObject[],
  ): DetectedObject | undefined => {
    return objects.find((o) => {
      // Same name
      if (o.name !== obj.name) return false;

      // Check if bounding boxes overlap significantly (IoU > 0.3)
      const x1 = Math.max(obj.boundingBox.left, o.boundingBox.left);
      const y1 = Math.max(obj.boundingBox.top, o.boundingBox.top);
      const x2 = Math.min(
        obj.boundingBox.left + obj.boundingBox.width,
        o.boundingBox.left + o.boundingBox.width,
      );
      const y2 = Math.min(
        obj.boundingBox.top + obj.boundingBox.height,
        o.boundingBox.top + o.boundingBox.height,
      );

      if (x2 < x1 || y2 < y1) return false; // No overlap

      const intersectionArea = (x2 - x1) * (y2 - y1);
      const obj1Area = obj.boundingBox.width * obj.boundingBox.height;
      const obj2Area = o.boundingBox.width * o.boundingBox.height;
      const unionArea = obj1Area + obj2Area - intersectionArea;

      const iou = intersectionArea / unionArea;
      return iou > IOU_THRESHOLD;
    });
  };

  const addedObjects: DetectedObject[] = [];
  const removedObjects: DetectedObject[] = [];
  const commonObjects: { source: DetectedObject; target: DetectedObject }[] =
    [];
  const processedTargetIndices = new Set<number>();

  // Find common and removed objects
  for (const sourceObj of sourceObjects) {
    const targetObjIndex = targetObjects.findIndex(
      (o, i) =>
        !processedTargetIndices.has(i) && findSimilarObject(sourceObj, [o]),
    );

    if (targetObjIndex !== -1) {
      commonObjects.push({
        source: sourceObj,
        target: targetObjects[targetObjIndex],
      });
      processedTargetIndices.add(targetObjIndex);
    } else {
      removedObjects.push(sourceObj);
    }
  }

  // Remaining objects in target are added objects
  targetObjects.forEach((obj, index) => {
    if (!processedTargetIndices.has(index)) {
      addedObjects.push(obj);
    }
  });

  return {
    addedObjects,
    removedObjects,
    commonObjects,
    summary: {
      totalAdded: addedObjects.length,
      totalRemoved: removedObjects.length,
      totalUnchanged: commonObjects.length,
    },
  };
}

async function getImageFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function createComparisonImage(
  targetImageBuffer: Buffer,
  addedObjects: DetectedObject[],
  commonObjects: { source: DetectedObject; target: DetectedObject }[],
  removedObjects: DetectedObject[],
): Promise<Buffer> {
  const image = sharp(targetImageBuffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error("Unable to get image dimensions");
  }

  // Create SVG overlay with different colors for different types of changes
  const svg = `
    <svg width="${width}" height="${height}">
      <!-- Added objects (green) -->
      ${addedObjects
        .map(
          (obj) => `
        <rect
          x="${obj.boundingBox.left * width}"
          y="${obj.boundingBox.top * height}"
          width="${obj.boundingBox.width * width}"
          height="${obj.boundingBox.height * height}"
          fill="rgba(0, 255, 0, 0.1)"
          stroke="#00ff00"
          stroke-width="3"
        />
        <rect
          x="${obj.boundingBox.left * width}"
          y="${Math.max(0, obj.boundingBox.top * height - 25)}"
          width="${Math.max(100, obj.name.length * 9)}"
          height="25"
          fill="#00ff00"
          opacity="0.9"
        />
        <text
          x="${obj.boundingBox.left * width + 5}"
          y="${Math.max(15, obj.boundingBox.top * height - 7)}"
          font-family="Arial"
          font-size="16"
          font-weight="bold"
          fill="white"
        >+ ${obj.name}</text>
        <text
          x="${obj.boundingBox.left * width + 5}"
          y="${obj.boundingBox.top * height + 20}"
          font-family="Arial"
          font-size="12"
          fill="#00ff00"
          stroke="white"
          stroke-width="0.5"
        >${Math.round(obj.confidence)}%</text>
      `,
        )
        .join("")}
      
      <!-- Common objects (blue) -->
      ${commonObjects
        .map(
          (obj) => `
        <rect
          x="${obj.target.boundingBox.left * width}"
          y="${obj.target.boundingBox.top * height}"
          width="${obj.target.boundingBox.width * width}"
          height="${obj.target.boundingBox.height * height}"
          fill="none"
          stroke="#0099ff"
          stroke-width="2"
          stroke-dasharray="8,4"
        />
        <text
          x="${obj.target.boundingBox.left * width + 5}"
          y="${Math.max(15, obj.target.boundingBox.top * height - 5)}"
          font-family="Arial"
          font-size="14"
          fill="#0099ff"
          stroke="white"
          stroke-width="0.5"
        >${obj.target.name}</text>
      `,
        )
        .join("")}
      
      <!-- Removed objects (shown in side panel) -->
      ${
        removedObjects.length > 0
          ? `
        <rect
          x="10"
          y="10"
          width="${Math.max(200, Math.max(...removedObjects.map((obj) => obj.name.length)) * 10 + 30)}"
          height="${40 + removedObjects.length * 25}"
          fill="white"
          opacity="0.95"
          stroke="#ff0000"
          stroke-width="2"
          rx="5"
        />
        <text
          x="20"
          y="35"
          font-family="Arial"
          font-size="16"
          font-weight="bold"
          fill="#ff0000"
        >Removed Objects:</text>
        ${removedObjects
          .map(
            (obj, index) => `
          <text
            x="25"
            y="${60 + index * 25}"
            font-family="Arial"
            font-size="14"
            fill="#ff0000"
          >• ${obj.name} (${Math.round(obj.confidence)}%)</text>
        `,
          )
          .join("")}
      `
          : ""
      }
      
      <!-- Legend -->
      <rect x="${width - 180}" y="10" width="170" height="100" fill="white" opacity="0.95" stroke="black" stroke-width="1" rx="5"/>
      <text x="${width - 170}" y="30" font-family="Arial" font-size="14" font-weight="bold">Legend:</text>
      <rect x="${width - 170}" y="40" width="20" height="15" fill="rgba(0, 255, 0, 0.5)" stroke="#00ff00" stroke-width="2"/>
      <text x="${width - 145}" y="52" font-family="Arial" font-size="12">Added (${addedObjects.length})</text>
      <rect x="${width - 170}" y="60" width="20" height="15" fill="none" stroke="#0099ff" stroke-width="2"/>
      <text x="${width - 145}" y="72" font-family="Arial" font-size="12">Unchanged (${commonObjects.length})</text>
      <rect x="${width - 170}" y="80" width="20" height="15" fill="rgba(255, 0, 0, 0.3)" stroke="#ff0000" stroke-width="2"/>
      <text x="${width - 145}" y="92" font-family="Arial" font-size="12">Removed (${removedObjects.length})</text>
      
      <!-- Detection info -->
      <text x="${width - 170}" y="105" font-family="Arial" font-size="10" fill="#666">Total detected: ${addedObjects.length + commonObjects.length + removedObjects.length}</text>
    </svg>`;

  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function uploadToS3(
  s3Client: S3Client,
  bucket: string,
  region: string,
  buffer: Buffer,
  key: string,
  contentType: string = "image/jpeg",
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Return the public URL of the uploaded image
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function generateImageKey(): string {
  const timestamp = Date.now();
  const randomId = crypto.randomBytes(8).toString("hex");
  return `room-comparisons/comparison-${timestamp}-${randomId}.jpg`;
}

export default async function (fastify: FastifyInstance) {
  fastify.post<{
    Body: RoomComparisonRequest;
    Reply: RoomComparisonResponse | ErrorResponse;
  }>(
    "/compare",
    { schema },
    async (
      request: FastifyRequest<{ Body: RoomComparisonRequest }>,
      reply: FastifyReply,
    ) => {
      const { sourceImageUrl, targetImageUrl, includeDebugInfo } = request.body;

      if (!sourceImageUrl || !targetImageUrl) {
        reply.status(400).send({
          error: "Both sourceImageUrl and targetImageUrl must be provided",
        });
        return;
      }

      try {
        const [sourceBuffer, targetBuffer] = await Promise.all([
          getImageFromUrl(sourceImageUrl),
          getImageFromUrl(targetImageUrl),
        ]);

        const [sourceLabels, targetLabels] = await Promise.all([
          detectLabels(sourceBuffer),
          detectLabels(targetBuffer),
        ]);

        // Debug logging
        const sourceWithInstances =
          sourceLabels.Labels?.filter(
            (l) => l.Instances && l.Instances.length > 0,
          ) || [];
        const targetWithInstances =
          targetLabels.Labels?.filter(
            (l) => l.Instances && l.Instances.length > 0,
          ) || [];

        console.log(
          "Source labels detected:",
          sourceLabels.Labels?.length || 0,
        );
        console.log(
          "Target labels detected:",
          targetLabels.Labels?.length || 0,
        );
        console.log(
          "Source labels with bounding boxes:",
          sourceWithInstances.map((l) => ({
            name: l.Name,
            instances: l.Instances?.length,
          })),
        );
        console.log(
          "Target labels with bounding boxes:",
          targetWithInstances.map((l) => ({
            name: l.Name,
            instances: l.Instances?.length,
          })),
        );

        const comparisonResult = compareRooms(
          sourceLabels.Labels || [],
          targetLabels.Labels || [],
        );

        // Log final comparison results
        console.log("Comparison results:", {
          added: comparisonResult.addedObjects.map(
            (o) => `${o.name} (${Math.round(o.confidence)}%)`,
          ),
          removed: comparisonResult.removedObjects.map(
            (o) => `${o.name} (${Math.round(o.confidence)}%)`,
          ),
          unchanged: comparisonResult.commonObjects.map(
            (o) => `${o.target.name} (${Math.round(o.target.confidence)}%)`,
          ),
        });

        // Create the final comparison image with all annotations
        const comparisonImageBuffer = await createComparisonImage(
          targetBuffer,
          comparisonResult.addedObjects,
          comparisonResult.commonObjects,
          comparisonResult.removedObjects,
        );

        // Generate unique key for S3
        const imageKey = generateImageKey();

        // Upload the comparison image to S3
        const comparisonImageUrl = await uploadToS3(
          fastify.s3.client,
          fastify.s3.bucket,
          fastify.s3.region,
          comparisonImageBuffer,
          imageKey,
        );

        const response: RoomComparisonResponse = {
          ...comparisonResult,
          comparisonImageUrl,
        };

        // Add debug info if requested
        if (includeDebugInfo) {
          const excludedSourceLabels =
            sourceLabels.Labels?.filter((l) =>
              EXCLUDED_LABELS.includes(l.Name || ""),
            ).map((l) => l.Name || "") || [];
          const excludedTargetLabels =
            targetLabels.Labels?.filter((l) =>
              EXCLUDED_LABELS.includes(l.Name || ""),
            ).map((l) => l.Name || "") || [];

          response.debugInfo = {
            totalSourceLabels: sourceLabels.Labels?.length || 0,
            totalTargetLabels: targetLabels.Labels?.length || 0,
            sourceLabelsWithBoxes: sourceWithInstances.length,
            targetLabelsWithBoxes: targetWithInstances.length,
            excludedLabels: [
              ...new Set([...excludedSourceLabels, ...excludedTargetLabels]),
            ],
          };
        }

        return response;
      } catch (error) {
        console.error("Error comparing rooms:", error);
        if (error instanceof Error) {
          reply.status(500).send({ error: error.message });
        } else {
          reply.status(500).send({
            error: "An unexpected error occurred while comparing rooms",
          });
        }
        return { error: "Error processing request" };
      }
    },
  );
}
