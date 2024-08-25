import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  RekognitionClient,
  DetectLabelsCommand,
  Label,
  RekognitionServiceException,
} from "@aws-sdk/client-rekognition";
import "dotenv/config";
import sharp from "sharp";

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
});

interface RoomComparisonRequest {
  sourceImageUrl: string;
  targetImageUrl: string;
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
  processedSourceImage: string;
  processedTargetImage: string;
}

const schema = {
  body: Type.Object({
    sourceImageUrl: Type.String(),
    targetImageUrl: Type.String(),
  }),
  response: {
    200: Type.Object({
      addedObjects: Type.Array(
        Type.Object({
          name: Type.String(),
          confidence: Type.Number(),
          boundingBox: Type.Object({
            left: Type.Number(),
            top: Type.Number(),
            width: Type.Number(),
            height: Type.Number(),
          }),
        })
      ),
      removedObjects: Type.Array(
        Type.Object({
          name: Type.String(),
          confidence: Type.Number(),
          boundingBox: Type.Object({
            left: Type.Number(),
            top: Type.Number(),
            width: Type.Number(),
            height: Type.Number(),
          }),
        })
      ),
      commonObjects: Type.Array(
        Type.Object({
          source: Type.Object({
            name: Type.String(),
            confidence: Type.Number(),
            boundingBox: Type.Object({
              left: Type.Number(),
              top: Type.Number(),
              width: Type.Number(),
              height: Type.Number(),
            }),
          }),
          target: Type.Object({
            name: Type.String(),
            confidence: Type.Number(),
            boundingBox: Type.Object({
              left: Type.Number(),
              top: Type.Number(),
              width: Type.Number(),
              height: Type.Number(),
            }),
          }),
        })
      ),
      processedSourceImage: Type.String(),
      processedTargetImage: Type.String(),
    }),
    400: Type.Object({
      error: Type.String(),
    }),
    500: Type.Object({
      error: Type.String(),
    }),
  },
};

async function detectLabels(image: Buffer) {
  try {
    const command = new DetectLabelsCommand({
      Image: { Bytes: image },
      MinConfidence: 85,
    });
    return rekognitionClient.send(command);
  } catch (error) {
    if (error instanceof RekognitionServiceException) {
      throw new Error(`Rekognition error: ${error.message}`);
    }
    throw error;
  }
}

function convertToDetectedObject(label: Label): DetectedObject {
  return {
    name: label.Name || "",
    confidence: label.Confidence || 0,
    boundingBox:
      label.Instances && label.Instances[0]
        ? {
            left: label.Instances[0].BoundingBox?.Left || 0,
            top: label.Instances[0].BoundingBox?.Top || 0,
            width: label.Instances[0].BoundingBox?.Width || 0,
            height: label.Instances[0].BoundingBox?.Height || 0,
          }
        : { left: 0, top: 0, width: 0, height: 0 },
  };
}

function compareRooms(
  sourceLabels: Label[],
  targetLabels: Label[]
): RoomComparisonResponse {
  const sourceObjects = sourceLabels.map(convertToDetectedObject);
  const targetObjects = targetLabels.map(convertToDetectedObject);

  const sourceMap = new Map(sourceObjects.map((obj) => [obj.name, obj]));
  const targetMap = new Map(targetObjects.map((obj) => [obj.name, obj]));

  const addedObjects: DetectedObject[] = [];
  const removedObjects: DetectedObject[] = [];
  const commonObjects: { source: DetectedObject; target: DetectedObject }[] =
    [];

  // Find common and removed objects
  for (const [name, sourceObj] of sourceMap) {
    const targetObj = targetMap.get(name);
    if (targetObj) {
      commonObjects.push({ source: sourceObj, target: targetObj });
      targetMap.delete(name); // Remove from targetMap to mark as processed
    } else {
      removedObjects.push(sourceObj);
    }
  }

  // Remaining objects in targetMap are added objects
  addedObjects.push(...targetMap.values());

  return {
    addedObjects,
    removedObjects,
    commonObjects,
    processedSourceImage: "",
    processedTargetImage: "",
  };
}

async function getImageFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function drawBoundingBoxes(
  imageBuffer: Buffer,
  objects: DetectedObject[],
  color: string
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error("Unable to get image dimensions");
  }

  const svg = `
    <svg width="${width}" height="${height}">
      ${objects
        .map(
          (obj) => `
        <rect
          x="${obj.boundingBox.left * width}"
          y="${obj.boundingBox.top * height}"
          width="${obj.boundingBox.width * width}"
          height="${obj.boundingBox.height * height}"
          fill="none"
          stroke="${color}"
          stroke-width="2"
        />
        <text
          x="${obj.boundingBox.left * width}"
          y="${obj.boundingBox.top * height - 5}"
          font-family="Arial"
          font-size="12"
          fill="${color}"
        >${obj.name}</text>
      `
        )
        .join("")}
    </svg>`;

  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();
}

export default async function (fastify: FastifyInstance) {
  fastify.post<{
    Body: RoomComparisonRequest;
    Reply: RoomComparisonResponse;
  }>(
    "/compare",
    { schema },
    async (
      request: FastifyRequest<{ Body: RoomComparisonRequest }>,
      reply: FastifyReply
    ) => {
      const { sourceImageUrl, targetImageUrl } = request.body;

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

        const comparisonResult = compareRooms(
          sourceLabels.Labels || [],
          targetLabels.Labels || []
        );

        // Process source image
        const processedSourceBuffer = await drawBoundingBoxes(
          sourceBuffer,
          [
            ...comparisonResult.commonObjects.map((obj) => obj.source),
            ...comparisonResult.removedObjects,
          ],
          "red"
        );

        // Process target image
        const processedTargetBuffer = await drawBoundingBoxes(
          targetBuffer,
          [
            ...comparisonResult.commonObjects.map((obj) => obj.target),
            ...comparisonResult.addedObjects,
          ],
          "green"
        );

        // Convert processed images to base64
        comparisonResult.processedSourceImage =
          processedSourceBuffer.toString("base64");
        comparisonResult.processedTargetImage =
          processedTargetBuffer.toString("base64");

        return comparisonResult;
      } catch (error) {
        console.error("Error comparing rooms:", error);
        if (error instanceof Error) {
          reply.status(500).send({ error: error.message });
        } else {
          reply.status(500).send({
            error: "An unexpected error occurred while comparing rooms",
          });
        }
      }
    }
  );
}
