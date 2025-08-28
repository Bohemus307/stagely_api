import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { SpaceType, Prisma } from "@prisma/client";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export interface ClaudeClassificationResult {
  spaceType: SpaceType;
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  labels: string[];
  featureVector: Prisma.JsonValue;
  suggestedName?: string;
  description?: string;
}

/**
 * Simplified classification service using AWS Bedrock with Claude Haiku
 */
export class ClaudeClassificationService {
  private bedrock: BedrockRuntimeClient;
  private s3Client: S3Client;
  private s3Bucket: string;
  private readonly MAX_LABELS = 50;

  constructor(s3Config: { client: S3Client; bucket: string; region: string }) {
    this.bedrock = new BedrockRuntimeClient({
      region:
        process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.ACCESS_KEY!,
        secretAccessKey: process.env.SECRET_ACCESS_KEY!,
      },
    });
    this.s3Client = s3Config.client;
    this.s3Bucket = s3Config.bucket;

    console.log("[CLAUDE] Classification service initialized with Bedrock");
  }

  /**
   * Extract S3 key from URL
   */
  private extractS3Key(imageUrl: string): string {
    try {
      const urlObj = new URL(imageUrl);
      return urlObj.pathname.startsWith("/")
        ? urlObj.pathname.substring(1)
        : urlObj.pathname;
    } catch {
      return imageUrl;
    }
  }

  /**
   * Get image from S3 and convert to base64
   */
  private async getImageAsBase64(imageUrl: string): Promise<string> {
    try {
      const key = this.extractS3Key(imageUrl);

      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error("Empty response from S3");
      }

      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(Buffer.from(chunk));
      }

      const buffer = Buffer.concat(chunks);
      return buffer.toString("base64");
    } catch (error) {
      console.error("[CLAUDE] Error fetching image from S3:", error);
      throw error;
    }
  }

  /**
   * Build the classification prompt
   */
  private getClassificationPrompt(): string {
    return `Analyze this property image and provide a classification.

Respond ONLY with a JSON object in this exact format:
{
  "spaceType": "Kitchen|LivingRoom|Bedroom|Bathroom|DiningRoom|Office|Garage|Basement|Hallway|Exterior|Attic|Laundry|Closet|Pantry|Mudroom|Foyer|Library|GameRoom|HomeTheater|Gym|Studio|GuestRoom|MasterBedroom|Balcony|Patio|Deck|Yard|Driveway|Other|Unknown",
  "confidence": "high|medium|low",
  "confidenceScore": 0.0-1.0,
  "suggestedName": "Brief descriptive name",
  "description": "Two sentence description of what you see",
  "labels": ["list", "of", "objects", "and", "features", "you", "can", "identify", "max", "50", "items"]
}

Guidelines:
- Use "high" confidence when clearly identifiable (>85% sure)
- Use "medium" confidence when probable but not certain (60-85% sure)  
- Use "low" confidence when unclear (<60% sure)
- For labels, list visible objects, fixtures, furniture, and notable features
- Order labels by prominence/importance in the scene
- Use "Unknown" only when completely unidentifiable
- confidenceScore should be a decimal between 0 and 1`;
  }

  /**
   * Parse Claude's response into our structure
   */
  private parseClaudeResponse(text: string): ClaudeClassificationResult {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and map space type
      const spaceType = this.validateSpaceType(parsed.spaceType);

      // Ensure labels array is within limit
      const labels = Array.isArray(parsed.labels)
        ? parsed.labels.slice(0, this.MAX_LABELS)
        : [];

      // Convert confidence to score if not provided
      const confidenceScore =
        parsed.confidenceScore ?? this.confidenceToScore(parsed.confidence);

      // Create feature vector from the classification
      const featureVector = this.createFeatureVector(
        spaceType,
        labels,
        confidenceScore,
      );

      return {
        spaceType,
        confidence: parsed.confidence || "medium",
        confidenceScore,
        labels,
        featureVector,
        suggestedName: parsed.suggestedName,
        description: parsed.description,
      };
    } catch (error) {
      console.error("[CLAUDE] Error parsing response:", error);
      return this.getDefaultClassification();
    }
  }

  /**
   * Validate space type against enum
   */
  private validateSpaceType(type: string): SpaceType {
    if (Object.values(SpaceType).includes(type as SpaceType)) {
      return type as SpaceType;
    }
    console.warn(`[CLAUDE] Invalid space type: ${type}, defaulting to Unknown`);
    return SpaceType.Unknown;
  }

  /**
   * Convert confidence level to numeric score
   */
  private confidenceToScore(confidence: string): number {
    switch (confidence) {
      case "high":
        return 0.9;
      case "medium":
        return 0.7;
      case "low":
        return 0.4;
      default:
        return 0.5;
    }
  }

  /**
   * Create feature vector for similarity comparisons
   */
  private createFeatureVector(
    spaceType: SpaceType,
    labels: string[],
    confidence: number,
  ): Prisma.JsonValue {
    // Create a simple but useful feature vector
    const vector = {
      spaceType,
      confidence,
      labelCount: labels.length,
      topLabels: labels.slice(0, 10),
      timestamp: new Date().toISOString(),
      modelVersion: "claude-3-haiku-bedrock",
    };

    return vector as Prisma.JsonValue;
  }

  /**
   * Get default classification for errors
   */
  private getDefaultClassification(): ClaudeClassificationResult {
    return {
      spaceType: SpaceType.Unknown,
      confidence: "low",
      confidenceScore: 0,
      labels: [],
      featureVector: {},
    };
  }

  /**
   * Classify a single image using Claude Haiku via Bedrock
   */
  async classifyImage(imageUrl: string): Promise<ClaudeClassificationResult> {
    const startTime = Date.now();
    console.log(`[CLAUDE] Classifying image: ${imageUrl.substring(0, 50)}...`);

    try {
      const imageBase64 = await this.getImageAsBase64(imageUrl);

      // Prepare the request for Bedrock
      const request = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: this.getClassificationPrompt(),
              },
            ],
          },
        ],
      };

      // Call Bedrock with Claude Haiku model
      const command = new InvokeModelCommand({
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(request),
      });

      const response = await this.bedrock.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const result = this.parseClaudeResponse(responseBody.content[0].text);

      const duration = Date.now() - startTime;
      console.log(
        `[CLAUDE] Classification completed in ${duration}ms - ${result.spaceType} (${result.confidence})`,
      );

      return result;
    } catch (error) {
      console.error("[CLAUDE] Classification failed:", error);
      return this.getDefaultClassification();
    }
  }

  /**
   * Classify multiple images of the same space
   */
  async classifyMultipleImages(
    imageUrls: string[],
  ): Promise<ClaudeClassificationResult> {
    if (imageUrls.length === 0) {
      return this.getDefaultClassification();
    }

    if (imageUrls.length === 1) {
      return this.classifyImage(imageUrls[0]);
    }

    // For multiple images, classify up to 3 for better accuracy
    const samplesToProcess = Math.min(3, imageUrls.length);
    const selectedImages = this.selectRepresentativeImages(
      imageUrls,
      samplesToProcess,
    );

    console.log(
      `[CLAUDE] Processing ${samplesToProcess} of ${imageUrls.length} images`,
    );

    const classifications = await Promise.all(
      selectedImages.map((url) => this.classifyImage(url)),
    );

    return this.combineClassifications(classifications);
  }

  /**
   * Select representative images from a list
   */
  private selectRepresentativeImages(
    imageUrls: string[],
    count: number,
  ): string[] {
    if (imageUrls.length <= count) {
      return imageUrls;
    }

    // Select evenly distributed images
    const selected: string[] = [];
    const step = Math.floor(imageUrls.length / count);

    for (let i = 0; i < count; i++) {
      const index = Math.min(i * step, imageUrls.length - 1);
      selected.push(imageUrls[index]);
    }

    return selected;
  }

  /**
   * Combine multiple classifications into one
   */
  private combineClassifications(
    classifications: ClaudeClassificationResult[],
  ): ClaudeClassificationResult {
    if (classifications.length === 0) {
      return this.getDefaultClassification();
    }

    if (classifications.length === 1) {
      return classifications[0];
    }

    // Count space type occurrences
    const spaceTypeCounts = new Map<SpaceType, number>();
    const allLabels = new Map<string, number>();
    let totalConfidence = 0;
    let descriptions: string[] = [];

    for (const classification of classifications) {
      // Count space types
      const count = spaceTypeCounts.get(classification.spaceType) || 0;
      spaceTypeCounts.set(classification.spaceType, count + 1);

      // Accumulate confidence
      totalConfidence += classification.confidenceScore;

      // Collect all labels with frequency
      for (const label of classification.labels) {
        const labelCount = allLabels.get(label) || 0;
        allLabels.set(label, labelCount + 1);
      }

      // Collect descriptions
      if (classification.description) {
        descriptions.push(classification.description);
      }
    }

    // Find most common space type
    let mostCommonType: SpaceType = SpaceType.Unknown;
    let maxCount = 0;
    for (const [type, count] of spaceTypeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonType = type;
      }
    }

    // Sort labels by frequency and take top 50
    const sortedLabels = Array.from(allLabels.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.MAX_LABELS)
      .map(([label]) => label);

    // Calculate average confidence
    const avgConfidence = totalConfidence / classifications.length;
    const confidence =
      avgConfidence > 0.85 ? "high" : avgConfidence > 0.6 ? "medium" : "low";

    // Combine descriptions
    const combinedDescription =
      descriptions.length > 0 ? descriptions[0] : undefined;

    // Create combined feature vector
    const featureVector = this.createFeatureVector(
      mostCommonType,
      sortedLabels,
      avgConfidence,
    );

    return {
      spaceType: mostCommonType,
      confidence,
      confidenceScore: avgConfidence,
      labels: sortedLabels,
      featureVector,
      suggestedName: classifications[0].suggestedName,
      description: combinedDescription,
    };
  }
}
