import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import crypto from "crypto";

// Configuration for Claude model - optimize for cost/performance
const CLAUDE_MODEL_OPTIONS = {
  // RECOMMENDED: Best value - 10x cheaper than Sonnet, doesn't work though with most images currently
  haiku: "anthropic.claude-3-haiku-20240307-v1:0",

  // Premium options (if you need higher accuracy works but pricey)
  sonnetV1: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  sonnetLatest: "us.anthropic.claude-3-5-sonnet-20241022-v2:0", // never use unless testing $$$$

  // Budget option (not recommended for vision tasks) but maybe someday
  instant: "anthropic.claude-instant-v1",
};

// Use SonnetV1 by default for best cost/performance ratio
const CLAUDE_MODEL_ID =
  process.env.CLAUDE_MODEL_ID || CLAUDE_MODEL_OPTIONS.sonnetV1;

export interface DetectedItem {
  name: string;
  position: {
    left: number;
    top: number;
  };
}

export interface ClaudeComparisonResult {
  added_items: DetectedItem[];
  removed_items: DetectedItem[];
  moved_items: {
    item: string;
    from: { left: number; top: number };
    to: { left: number; top: number };
  }[];
  overall_changes: string;
}

export interface RoomComparisonResponse {
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

/**
 * Fetch image from URL
 */
async function getImageFromUrl(url: string): Promise<Buffer> {
  const cloudFrontUrl = url.includes("amazonaws.com")
    ? url.replace(
        /https:\/\/[^\/]+amazonaws\.com\//,
        "https://d24y6hzot6c372.cloudfront.net/",
      )
    : url;

  const response = await fetch(cloudFrontUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Analyze room changes with Claude Vision
 */
export async function analyzeWithClaude(
  bedrockClient: BedrockRuntimeClient,
  sourceBuffer: Buffer,
  targetBuffer: Buffer,
): Promise<ClaudeComparisonResult> {
  const maxSize = 1568; // Max dimension for Claude

  // Helper function to safely process image with Sharp
  async function processImage(
    buffer: Buffer,
    imageName: string,
  ): Promise<string> {
    try {
      // Try to get metadata and resize if needed
      const metadata = await sharp(buffer).metadata();
      console.log(`${imageName} metadata:`, {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      });

      // If image is too large, resize it
      if (metadata.width! > maxSize || metadata.height! > maxSize) {
        console.log(
          `${imageName} needs resizing from ${metadata.width}x${metadata.height}`,
        );
        const resized = await sharp(buffer)
          .resize(maxSize, maxSize, { fit: "inside" })
          .jpeg() // Convert to JPEG during resize
          .toBuffer();
        return resized.toString("base64");
      }

      // If size is OK, just return base64
      return buffer.toString("base64");
    } catch (error: any) {
      // Check if it's a HEIC/HEIF error
      if (
        error.message.includes("heif") ||
        error.message.includes("heic") ||
        error.message.includes("No decoding plugin") ||
        error.message.includes("bad seek to")
      ) {
        console.warn(
          `${imageName} appears to be HEIC/HEIF, sending without resize`,
        );

        // Check file size - warn if it's very large
        const sizeMB = buffer.length / (1024 * 1024);
        if (sizeMB > 5) {
          console.warn(
            `Warning: ${imageName} is ${sizeMB.toFixed(2)}MB - may hit Claude's limits`,
          );
        }

        // Return original buffer as base64 without processing
        return buffer.toString("base64");
      }

      // If it's not a HEIC error, throw it
      console.error(`Failed to process ${imageName}:`, error);
      throw error;
    }
  }

  // Process both images
  const [processedSourceBase64, processedTargetBase64] = await Promise.all([
    processImage(sourceBuffer, "source image"),
    processImage(targetBuffer, "target image"),
  ]);

  console.log("Images processed, sending to Claude...");

  // Rest of your Claude API call remains the same
  const prompt = `Compare these two room images and identify what changed.

    First image = BEFORE (reference state)
    Second image = AFTER (current state)

    Focus on furniture, appliances, and large items only.
    Ignore: small items under 1ft, lighting changes, shadows, camera angles, people.

    Return ONLY this JSON:
    {
      "added_items": [
        {"name": "item name", "position": {"left": 0-100, "top": 0-100}}
      ],
      "removed_items": [
        {"name": "item name", "position": {"left": 0-100, "top": 0-100}}
      ],
      "moved_items": [
        {"item": "name", "from": {"left": 0-100, "top": 0-100}, "to": {"left": 0-100, "top": 0-100}}
      ],
      "overall_changes": "One sentence summary. Say 'No significant changes' if rooms look the same."
    }

    Positions are percentages from top-left corner.
    Be specific with names (e.g. "wooden chair" not just "chair").
    Only report changes you're confident about.`;

  try {
    console.log(`Using Claude model: ${CLAUDE_MODEL_ID}`);

    const response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId: CLAUDE_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1024,
          temperature: 0,
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
    const content = responseBody.content[0].text;

    try {
      return JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
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

/**
 * Upload image to S3
 */
export async function uploadToS3(
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

/**
 * Generate unique image key for S3
 */
export function generateImageKey(): string {
  const timestamp = Date.now();
  const randomId = crypto.randomBytes(8).toString("hex");
  return `room-comparisons/claude-comparison-${timestamp}-${randomId}.jpg`;
}

/**
 * Main function to compare room images
 */
export async function compareRoomImages(
  bedrockClient: BedrockRuntimeClient,
  s3Client: S3Client,
  s3Bucket: string,
  s3Region: string,
  sourceImageUrl: string,
  targetImageUrl: string,
): Promise<RoomComparisonResponse> {
  // Fetch both images
  const [sourceBuffer, targetBuffer] = await Promise.all([
    getImageFromUrl(sourceImageUrl),
    getImageFromUrl(targetImageUrl),
  ]);

  console.log("Analyzing images with Claude Vision...");

  const claudeResult = await analyzeWithClaude(
    bedrockClient,
    sourceBuffer,
    targetBuffer,
  );

  console.log("Claude analysis complete:", {
    added: claudeResult.added_items.length,
    removed: claudeResult.removed_items.length,
    moved: claudeResult.moved_items.length,
    changed: claudeResult.overall_changes,
  });

  const imageKey = generateImageKey();
  const comparisonImageUrl = await uploadToS3(
    s3Client,
    s3Bucket,
    s3Region,
    targetBuffer,
    imageKey,
  );

  return {
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
}
