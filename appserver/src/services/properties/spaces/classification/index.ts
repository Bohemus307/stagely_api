import {
  RekognitionClient,
  DetectLabelsCommand,
  Label,
} from "@aws-sdk/client-rekognition";
import { SpaceType, Prisma } from "@prisma/client";
import { ClassificationResult, S3Config } from "./classificationTypes";
import { ImageProcessor } from "./imageProcessor";
import { LabelProcessor } from "./labelProcessor";

/**
 * Service for classifying property spaces using AWS Rekognition
 */
export class SpaceClassificationService {
  private rekognition: RekognitionClient;
  private imageProcessor: ImageProcessor;
  private labelProcessor: LabelProcessor;

  constructor(fastifyS3: S3Config) {
    this.rekognition = new RekognitionClient({
      region: fastifyS3.region,
      // Enable timeout configuration
      requestHandler: {
        timeoutInMs: 10000, // 10 second timeout for Rekognition requests
      } as any,
    });

    this.imageProcessor = new ImageProcessor(
      fastifyS3.client,
      fastifyS3.bucket,
    );
    this.labelProcessor = new LabelProcessor();

    console.log(`[INIT] Service initialized successfully`);
  }

  /**
   * Classify an image from its URL
   */
  async classifyImage(imageUrl: string): Promise<ClassificationResult> {
    console.log(
      `[CLASSIFY] Starting classification for image: ${imageUrl.substring(0, 50)}...`,
    );

    const startTime = Date.now();

    try {
      // Extract S3 key from URL
      const key = this.imageProcessor.extractS3Key(imageUrl);

      const imageData = await this.imageProcessor.getOptimizedImageFromS3(key);
      console.log(
        `[CLASSIFY] Image optimized from S3: ${key}, size: ${imageData.length} bytes`,
      );

      // Analyze with Rekognition (with timeout)
      let labels: Label[] = [];
      try {
        labels = await Promise.race([
          this.detectLabels(imageData),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Rekognition timeout")), 12000),
          ),
        ]);
      } catch (rekognitionError) {
        console.error("Rekognition processing failed:", rekognitionError);
        // Continue with empty labels instead of failing
        labels = [];
        console.log(`[CLASSIFY] Rekognition failed - using empty labels`);
      }

      const result = this.labelProcessor.processLabels(labels);

      const totalTime = Date.now() - startTime;
      console.log(
        `[CLASSIFY] Classification completed in ${totalTime}ms. Result: Space=${result.spaceType}, Confidence=${result.confidenceScore}`,
      );

      return result;
    } catch (error) {
      console.error(
        `[CLASSIFY] ERROR classifying image: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(
        `[CLASSIFY] Full error stack: ${error instanceof Error ? error.stack : "No stack available"}`,
      );

      // Return a default result instead of throwing
      return {
        spaceType: SpaceType.Unknown,
        confidenceScore: 0,
        labels: [],
        featureVector: {},
      };
    }
  }

  /**
   * Detect labels in an image using Rekognition with optimized parameters
   */
  private async detectLabels(imageData: Buffer): Promise<Label[]> {
    // Use optimized parameters for faster processing with better results
    const command = new DetectLabelsCommand({
      Image: { Bytes: imageData },
      MaxLabels: 30, // Increased from 20 for better classification
      MinConfidence: 60, // Lowered from 70 to capture more potential indicators
    });

    try {
      const startTime = Date.now();
      const response = await this.rekognition.send(command);
      const duration = Date.now() - startTime;
      console.log(
        `[REKOGNITION] Request successful, received ${response.Labels?.length || 0} labels in ${duration}ms`,
      );
      return response.Labels || [];
    } catch (error) {
      console.error(
        `[REKOGNITION] ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Wait a short time before retrying once
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        // Add explicit try/catch for the retry
        console.log(`[REKOGNITION] Retrying Rekognition request`);
        const retryStartTime = Date.now();
        const response = await this.rekognition.send(command);
        const retryDuration = Date.now() - retryStartTime;
        console.log(
          `[REKOGNITION] Retry successful, received ${response.Labels?.length || 0} labels in ${retryDuration}ms`,
        );
        return response.Labels || [];
      } catch (retryError) {
        console.error(
          `[REKOGNITION] RETRY ERROR: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
        // Return empty array instead of failing
        return [];
      }
    }
  }

  /**
   * Batch process multiple images and determine the most likely space type
   */
  async classifyMultipleImages(
    imageUrls: string[],
  ): Promise<ClassificationResult> {
    if (imageUrls.length === 0) {
      return {
        spaceType: SpaceType.Unknown,
        confidenceScore: 0,
        labels: [],
        featureVector: {},
      };
    }

    // Setup progress tracking
    const total = imageUrls.length;
    let completed = 0;

    // Process in parallel with robust error handling
    const resultPromises = imageUrls.map(async (url) => {
      try {
        const result = await this.classifyImage(url);
        // Track progress
        completed++;
        console.log(
          `Classification progress: ${completed}/${total} (${Math.round((completed / total) * 100)}%)`,
        );
        return result;
      } catch (error) {
        console.error(`Failed to classify ${url}:`, error);
        // Return null instead of throwing to continue with other images
        return null;
      }
    });

    // Wait for all to complete
    const allResults = await Promise.all(resultPromises);

    // Filter out nulls
    const results = allResults.filter(
      (r): r is ClassificationResult => r !== null,
    );

    if (results.length === 0) {
      return {
        spaceType: SpaceType.Unknown,
        confidenceScore: 0,
        labels: [],
        featureVector: {},
      };
    }

    // Combine results
    return this.combineClassificationResults(results);
  }

  /**
   * Combine multiple classification results into a single result
   */
  private combineClassificationResults(
    results: ClassificationResult[],
  ): ClassificationResult {
    if (results.length === 0) {
      return {
        spaceType: SpaceType.Unknown,
        confidenceScore: 0,
        labels: [],
        featureVector: {},
      };
    }

    if (results.length === 1) {
      return results[0];
    }

    // Combine results to find most likely space type
    const spaceScores: Record<SpaceType, number> = {
      [SpaceType.Kitchen]: 0,
      [SpaceType.LivingRoom]: 0,
      [SpaceType.Bedroom]: 0,
      [SpaceType.Bathroom]: 0,
      [SpaceType.Hallway]: 0,
      [SpaceType.Exterior]: 0,
      [SpaceType.Garage]: 0,
      [SpaceType.Other]: 0,
      [SpaceType.Unknown]: 0,
    };

    // Combine all detected labels
    const allLabels: string[] = [];

    results.forEach((result) => {
      // Add to space type score with weight based on confidence
      spaceScores[result.spaceType] += result.confidenceScore * 100;

      // Add to all labels
      allLabels.push(...result.labels);
    });

    // Find best space type
    let bestType: SpaceType = SpaceType.Unknown;
    let highestScore = 0;

    Object.entries(spaceScores).forEach(([type, score]) => {
      if (score > highestScore) {
        highestScore = score;
        bestType = type as SpaceType;
      }
    });

    // Calculate average confidence with a minimum threshold
    const avgConfidence = Math.max(0.15, highestScore / (results.length * 100));

    // Count label frequencies
    const labelFrequency: Record<string, number> = {};
    allLabels.forEach((label) => {
      labelFrequency[label] = (labelFrequency[label] || 0) + 1;
    });

    // Get most common labels
    const topLabels = Object.entries(labelFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label]) => label);

    // Create aggregate feature vector
    const featureVector = this.combineFeatureVectors(
      results.map((r) => r.featureVector as any),
    );

    return {
      spaceType: bestType,
      confidenceScore: avgConfidence,
      labels: topLabels,
      featureVector,
    };
  }

  /**
   * Combine multiple feature vectors into one
   */
  private combineFeatureVectors(vectors: any[]): Prisma.JsonValue {
    if (vectors.length === 0) {
      return {};
    }

    const allObjects = new Set<string>();
    const allColors = new Set<string>();
    const objectCounts: Record<string, number> = {};
    const colorCounts: Record<string, number> = {};

    vectors.forEach((vector) => {
      // Combine objects
      if (vector.detectedObjects && Array.isArray(vector.detectedObjects)) {
        vector.detectedObjects.forEach((obj: string) => {
          allObjects.add(obj);
          objectCounts[obj] = (objectCounts[obj] || 0) + 1;
        });
      }

      // Combine colors
      if (vector.dominantColors && Array.isArray(vector.dominantColors)) {
        vector.dominantColors.forEach((color: string) => {
          allColors.add(color);
          colorCounts[color] = (colorCounts[color] || 0) + 1;
        });
      }
    });

    // Sort by frequency
    const topObjects = Array.from(allObjects)
      .sort((a, b) => objectCounts[b] - objectCounts[a])
      .slice(0, 10);

    const topColors = Array.from(allColors)
      .sort((a, b) => colorCounts[b] - colorCounts[a])
      .slice(0, 3);

    // Create dimensions by averaging
    let dimensions: number[] = [];
    if (vectors[0]?.dimensions && Array.isArray(vectors[0].dimensions)) {
      const dimensionLength = vectors[0].dimensions.length;
      dimensions = Array(dimensionLength).fill(0);

      vectors.forEach((vector) => {
        if (vector.dimensions && vector.dimensions.length === dimensionLength) {
          for (let i = 0; i < dimensionLength; i++) {
            dimensions[i] += vector.dimensions[i] / vectors.length;
          }
        }
      });
    }

    return {
      dimensions: dimensions as Prisma.JsonValue,
      dominantColors: topColors,
      detectedObjects: topObjects,
    };
  }
}
