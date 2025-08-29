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

// Types
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
      return result;
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
