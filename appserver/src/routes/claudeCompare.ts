import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import "dotenv/config";
import sharp from "sharp";
import crypto from "crypto";

// Configuration for Claude model - optimize for cost/performance
const CLAUDE_MODEL_OPTIONS = {
  // RECOMMENDED: Best value - 10x cheaper than Sonnet, doesnt work though with most images currently
  haiku: "anthropic.claude-3-haiku-20240307-v1:0",

  // Premium options (if you need higher accuracy works but pricey
  sonnetV1: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  sonnetLatest: "us.anthropic.claude-3-5-sonnet-20241022-v2:0", // never use unless testing $$$$

  // Budget option (not recommended for vision tasks) but maybe someday
  instant: "anthropic.claude-instant-v1",
};

// Use SonnetV1 by default for best cost/performance ratio
const CLAUDE_MODEL_ID =
  process.env.CLAUDE_MODEL_ID || CLAUDE_MODEL_OPTIONS.sonnetV1;

const bedrockClient = new BedrockRuntimeClient({
  region:
    process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.ACCESS_KEY!,
    secretAccessKey: process.env.SECRET_ACCESS_KEY!,
  },
});

interface RoomComparisonRequest {
  sourceImageUrl: string;
  targetImageUrl: string;
}

interface DetectedItem {
  name: string;
  position: {
    left: number;
    top: number;
  };
}

interface ClaudeComparisonResult {
  added_items: DetectedItem[];
  removed_items: DetectedItem[];
  moved_items: {
    item: string;
    from: { left: number; top: number };
    to: { left: number; top: number };
  }[];
  overall_changes: string;
}

interface RoomComparisonResponse {
  addedItems: DetectedItem[];
  removedItems: DetectedItem[];
  movedItems: {
    item: string;
    from: { left: number; top: number };
    to: { left: number; top: number };
  }[];
  comparisonImageUrl: string;
  summary: {
    totalAdded: number;
    totalRemoved: number;
    totalMoved: number;
    overallChanges: string;
  };
  claudeAnalysis: string;
}

interface ErrorResponse {
  error: string;
}

declare module "fastify" {
  interface FastifyInstance {
    s3: {
      client: S3Client;
      bucket: string;
      region: string;
    };
  }
}

const schema = {
  tags: ["compare-images"],
  body: {
    type: "object",
    required: ["sourceImageUrl", "targetImageUrl"],
    properties: {
      sourceImageUrl: { type: "string" },
      targetImageUrl: { type: "string" },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        addedItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              position: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
                },
              },
            },
          },
        },
        removedItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              position: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
                },
              },
            },
          },
        },
        movedItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              from: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
                },
              },
              to: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
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
            totalMoved: { type: "number" },
            overallChanges: { type: "string" },
          },
        },
        claudeAnalysis: { type: "string" },
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

async function getImageFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function analyzeWithClaude(
  sourceBuffer: Buffer,
  targetBuffer: Buffer,
): Promise<ClaudeComparisonResult> {
  // Convert images to base64
  const sourceBase64 = sourceBuffer.toString("base64");
  const targetBase64 = targetBuffer.toString("base64");

  // Resize images if they're too large (Claude has limits)
  const maxSize = 1568; // Max dimension for Claude
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  const targetMetadata = await sharp(targetBuffer).metadata();

  let processedSourceBase64 = sourceBase64;
  let processedTargetBase64 = targetBase64;

  if (sourceMetadata.width! > maxSize || sourceMetadata.height! > maxSize) {
    const resized = await sharp(sourceBuffer)
      .resize(maxSize, maxSize, { fit: "inside" })
      .toBuffer();
    processedSourceBase64 = resized.toString("base64");
  }

  if (targetMetadata.width! > maxSize || targetMetadata.height! > maxSize) {
    const resized = await sharp(targetBuffer)
      .resize(maxSize, maxSize, { fit: "inside" })
      .toBuffer();
    processedTargetBase64 = resized.toString("base64");
  }

  const prompt = `Compare these two room images. Look for furniture and large objects only.

Return ONLY a JSON object (no other text) with this exact structure:
{
  "added_items": [
    {"name": "item", "position": {"left": 0-100, "top": 0-100}}
  ],
  "removed_items": [
    {"name": "item", "position": {"left": 0-100, "top": 0-100}}
  ],
  "moved_items": [
    {"item": "name", "from": {"left": 0-100, "top": 0-100}, "to": {"left": 0-100, "top": 0-100}}
  ],
  "damaged_items": [
    {"name": "item", "position": {"left": 0-100, "top": 0-100}}
  ],
  "overall_changes": "two sentence summary"
}

Focus on: furniture, appliances, large decor (ignore small items under 1ft).
Positions are percentages from top-left corner.`;

  try {
    console.log(`Using Claude model: ${CLAUDE_MODEL_ID}`);

    const response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId: CLAUDE_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1024, // Reduced for simpler responses (saves tokens)
          temperature: 0, // Deterministic responses
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "First image (before):",
                },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: processedSourceBase64,
                  },
                },
                {
                  type: "text",
                  text: "Second image (after):",
                },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: processedTargetBase64,
                  },
                },
                {
                  type: "text",
                  text: prompt,
                },
              ],
            },
          ],
        }),
      }),
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Extract the JSON from Claude's response
    const content = responseBody.content[0].text;

    // Try to parse the JSON response
    try {
      const result = JSON.parse(content);
      return result as ClaudeComparisonResult;
    } catch (parseError) {
      // If parsing fails, try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ClaudeComparisonResult;
      }
      throw new Error("Failed to parse Claude's response as JSON");
    }
  } catch (error) {
    console.error("Error calling Claude:", error);
    throw new Error(
      `Claude analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
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
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function generateImageKey(): string {
  const timestamp = Date.now();
  const randomId = crypto.randomBytes(8).toString("hex");
  return `room-comparisons/claude-comparison-${timestamp}-${randomId}.jpg`;
}

/**
 * Room comparison endpoint using Claude Vision via AWS Bedrock
 *
 * Cost estimates (per comparison):
 * - Claude 3 Haiku: ~$0.002 (RECOMMENDED)
 * - Claude 3 Sonnet: ~$0.024
 * - Claude 3.5 Sonnet: ~$0.024
 *
 * Haiku provides 80% of Sonnet's accuracy at 10% of the cost but doesnt work for this type of comparison currently
 *
 */
export default async function (fastify: FastifyInstance) {
  fastify.post<{
    Body: RoomComparisonRequest;
    Reply: RoomComparisonResponse | ErrorResponse;
  }>(
    "/compare-images",
    { schema },
    async (
      request: FastifyRequest<{ Body: RoomComparisonRequest }>,
      reply: FastifyReply,
    ) => {
      const { sourceImageUrl, targetImageUrl } = request.body;

      if (!sourceImageUrl || !targetImageUrl) {
        reply.status(400).send({
          error: "Both Image Url's must be provided",
        });
        return;
      }

      try {
        // Fetch both images
        const [sourceBuffer, targetBuffer] = await Promise.all([
          getImageFromUrl(sourceImageUrl),
          getImageFromUrl(targetImageUrl),
        ]);

        console.log("Analyzing images with Claude Vision...");

        // Analyze with Claude
        const claudeResult = await analyzeWithClaude(
          sourceBuffer,
          targetBuffer,
        );

        console.log("Claude analysis complete:", {
          added: claudeResult.added_items.length,
          removed: claudeResult.removed_items.length,
          moved: claudeResult.moved_items.length,
        });

        // Upload to S3
        const imageKey = generateImageKey();
        const comparisonImageUrl = await uploadToS3(
          fastify.s3.client,
          fastify.s3.bucket,
          fastify.s3.region,
          targetBuffer,
          imageKey,
        );

        // Format response
        const response: RoomComparisonResponse = {
          addedItems: claudeResult.added_items,
          removedItems: claudeResult.removed_items,
          movedItems: claudeResult.moved_items,
          comparisonImageUrl,
          summary: {
            totalAdded: claudeResult.added_items.length,
            totalRemoved: claudeResult.removed_items.length,
            totalMoved: claudeResult.moved_items.length,
            overallChanges: claudeResult.overall_changes,
          },
          claudeAnalysis: claudeResult.overall_changes,
        };

        return response;
      } catch (error) {
        console.error("Error comparing rooms with Claude:", error);
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
