import {
  RekognitionClient,
  DetectLabelsCommand,
  Label,
} from "@aws-sdk/client-rekognition";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { SpaceType, Prisma } from "@prisma/client";
import sharp from "sharp"; // You'll need to add this to your dependencies

// Classification result interface
export interface ClassificationResult {
  spaceType: SpaceType;
  confidenceScore: number;
  labels: string[];
  featureVector: Prisma.JsonValue;
}

/**
 * Service for classifying property spaces using AWS Rekognition
 */
export class SpaceClassificationService {
  private rekognition: RekognitionClient;
  private s3Client: S3Client;
  private s3Bucket: string;
  private cache: Map<string, ClassificationResult> = new Map();
  // Add caching for S3 objects to prevent redundant downloads
  private s3Cache: Map<string, { buffer: Buffer; timestamp: number }> =
    new Map();
  private readonly S3_CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  private readonly MAX_S3_CACHE_SIZE = 50; // Limit cache size

  // Mapping of AWS Rekognition labels to SpaceType
  private readonly LABEL_TO_SPACE: Record<string, SpaceType> = {
    // Kitchen indicators
    Kitchen: SpaceType.Kitchen,
    Oven: SpaceType.Kitchen,
    Refrigerator: SpaceType.Kitchen,
    Sink: SpaceType.Kitchen,
    Microwave: SpaceType.Kitchen,
    Dishwasher: SpaceType.Kitchen,
    Counter: SpaceType.Kitchen,

    // Living Room indicators
    "Living Room": SpaceType.LivingRoom,
    Couch: SpaceType.LivingRoom,
    Sofa: SpaceType.LivingRoom,
    Television: SpaceType.LivingRoom,
    "Coffee Table": SpaceType.LivingRoom,
    "Entertainment Center": SpaceType.LivingRoom,

    // Bedroom indicators
    Bedroom: SpaceType.Bedroom,
    Bed: SpaceType.Bedroom,
    Dresser: SpaceType.Bedroom,
    Wardrobe: SpaceType.Bedroom,
    Nightstand: SpaceType.Bedroom,

    // Bathroom indicators
    Bathroom: SpaceType.Bathroom,
    Toilet: SpaceType.Bathroom,
    Bathtub: SpaceType.Bathroom,
    Shower: SpaceType.Bathroom,
    Bath: SpaceType.Bathroom,

    // Hallway indicators
    Hallway: SpaceType.Hallway,
    Corridor: SpaceType.Hallway,
    Stairs: SpaceType.Hallway,

    // Exterior indicators
    Yard: SpaceType.Exterior,
    Garden: SpaceType.Exterior,
    Patio: SpaceType.Exterior,
    Building: SpaceType.Exterior,
    Porch: SpaceType.Exterior,

    // Garage indicators
    Garage: SpaceType.Garage,
    Car: SpaceType.Garage,
    Parking: SpaceType.Garage,
  };

  constructor(fastifyS3: { client: S3Client; bucket: string; region: string }) {
    console.log(`[INIT] Initializing SpaceClassificationService`);
    console.log(`[INIT] AWS Region: ${fastifyS3.region}`);
    console.log(`[INIT] S3 Bucket: ${fastifyS3.bucket}`);

    this.rekognition = new RekognitionClient({
      region: fastifyS3.region,
      // Enable timeout configuration
      requestHandler: {
        timeoutInMs: 15000, // 15 second timeout for Rekognition requests
      } as any,
    });
    this.s3Client = fastifyS3.client;
    this.s3Bucket = fastifyS3.bucket;

    console.log(`[INIT] Service initialized successfully`);
  }

  /**
   * Classify an image from its URL
   */
  async classifyImage(imageUrl: string): Promise<ClassificationResult> {
    console.log(
      `[CLASSIFY] Starting classification for image: ${imageUrl.substring(0, 50)}...`,
    );
    try {
      // Check cache first
      const cacheKey = this.getCacheKey(imageUrl);
      if (this.cache.has(cacheKey)) {
        console.log(`[CLASSIFY] Cache hit for ${cacheKey}`);
        return this.cache.get(cacheKey)!;
      }
      console.log(`[CLASSIFY] Cache miss for ${cacheKey}`);

      // Extract S3 key from URL
      const key = this.extractS3Key(imageUrl);
      console.log(`[CLASSIFY] Extracted S3 key: ${key}`);

      // Get optimized image data from S3
      console.log(`[CLASSIFY] Fetching image from S3: ${key}`);
      const imageData = await this.getOptimizedImageFromS3(key);
      console.log(
        `[CLASSIFY] Image optimized from S3: ${key}, size: ${imageData.length} bytes`,
      );

      // Analyze with Rekognition (with timeout)
      console.log(`[CLASSIFY] Starting Rekognition analysis for ${key}`);
      let labels: Label[] = [];
      try {
        labels = await Promise.race([
          this.detectLabels(imageData),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Rekognition timeout")), 20000),
          ),
        ]);
        console.log(`Detected ${labels.length} labels with Rekognition`);
      } catch (rekognitionError) {
        console.error("Rekognition processing failed:", rekognitionError);
        // Continue with empty labels instead of failing
        labels = [];
        console.log(`[CLASSIFY] Rekognition failed - using empty labels`);
      }

      // Process labels to determine space type
      console.log(
        `[CLASSIFY] Processing ${labels.length} labels: ${labels.map((l) => l.Name).join(", ")}`,
      );
      const result = this.processLabels(labels);
      console.log(
        `[CLASSIFY] Classification result: Space=${result.spaceType}, Confidence=${result.confidenceScore}`,
      );

      // Cache the result
      this.cache.set(cacheKey, result);
      console.log(`[CLASSIFY] Result cached for ${cacheKey}`);

      return result;
    } catch (error) {
      console.error(
        `[CLASSIFY] ERROR classifying image: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(
        `[CLASSIFY] Full error stack: ${error instanceof Error ? error.stack : "No stack available"}`,
      );

      // Log environment info to help diagnose production issues
      console.log(`[CLASSIFY] Environment: NODE_ENV=${process.env.NODE_ENV}`);
      console.log(`[CLASSIFY] AWS Region: ${this.rekognition.config.region}`);

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
   * Create a cache key from image URL
   */
  private getCacheKey(imageUrl: string): string {
    return imageUrl.split("?")[0]; // Strip query parameters for more effective caching
  }

  /**
   * Extract S3 key from image URL
   */
  private extractS3Key(imageUrl: string): string {
    try {
      const urlObj = new URL(imageUrl);
      // Strip any leading slash for consistent key format
      return urlObj.pathname.startsWith("/")
        ? urlObj.pathname.substring(1)
        : urlObj.pathname;
    } catch (e) {
      // If URL parsing fails, assume the URL is the key
      return imageUrl;
    }
  }

  /**
   * Get image data from S3 with optimizations
   */
  private async getOptimizedImageFromS3(key: string): Promise<Buffer> {
    console.log(`[S3] Fetching image: ${key}`);
    try {
      // Check S3 cache first
      const now = Date.now();
      if (this.s3Cache.has(key)) {
        const cached = this.s3Cache.get(key)!;
        if (now - cached.timestamp < this.S3_CACHE_TTL) {
          console.log(
            `[S3] Cache hit for ${key}, size: ${cached.buffer.length} bytes`,
          );
          return cached.buffer;
        } else {
          // Expired, remove from cache
          console.log(`[S3] Cache expired for ${key}`);
          this.s3Cache.delete(key);
        }
      }
      console.log(`[S3] Cache miss for ${key}`);

      // Log the S3 bucket we're accessing
      console.log(`[S3] Using bucket: ${this.s3Bucket}`);

      // Check if the object exists
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
        });
        const headResult = await this.s3Client.send(headCommand);
        console.log(
          `[S3] Object exists, size: ${headResult.ContentLength || "unknown"} bytes, type: ${headResult.ContentType || "unknown"}`,
        );
      } catch (headError) {
        console.error(
          `[S3] Object HEAD check failed: ${headError instanceof Error ? headError.message : String(headError)}`,
        );
      }

      // Try a faster approach first - get a partial range of the image
      // This works for most images and is much faster
      try {
        const command = new GetObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Range: "bytes=0-4194304", // First 4MB - enough for most images
        });

        console.log(`[S3] Sending partial range request (0-4MB) for ${key}`);
        const startTime = Date.now();
        const response = await this.s3Client.send(command);
        const duration = Date.now() - startTime;
        console.log(`[S3] Partial range request completed in ${duration}ms`);

        if (response.Body) {
          console.log(`[S3] Processing response body stream`);
          // Convert stream to buffer efficiently
          const chunks: Buffer[] = [];
          for await (const chunk of response.Body as any) {
            chunks.push(Buffer.from(chunk));
          }

          const originalBuffer = Buffer.concat(chunks);
          console.log(
            `[S3] Stream converted to buffer, size: ${originalBuffer.length} bytes`,
          );

          // Try to process this partial image
          try {
            // Resize the image for classification (smaller = faster processing)
            const resizedBuffer = await sharp(originalBuffer)
              .resize(400, 400, { fit: "inside" }) // Smaller size for better performance
              .jpeg({ quality: 70 }) // Lower quality for faster processing
              .toBuffer();

            // Cache the resized image
            if (this.s3Cache.size >= this.MAX_S3_CACHE_SIZE) {
              const oldestKey = this.s3Cache.keys().next().value;
              this.s3Cache.delete(oldestKey as string);
            }

            this.s3Cache.set(key, { buffer: resizedBuffer, timestamp: now });
            return resizedBuffer;
          } catch (resizeError) {
            // If partial image couldn't be processed, fall back to full image
            console.warn(
              `Partial image processing failed for ${key}, getting full image: ${resizeError}`,
            );
            // Continue to full image download below
          }
        }
      } catch (rangeError) {
        // Range request failed, fall back to full image
        console.warn(
          `Range request failed for ${key}, getting full image: ${rangeError}`,
        );
      }

      // Fall back to getting the full image if needed
      const fullCommand = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      const fullResponse = await this.s3Client.send(fullCommand);

      if (!fullResponse.Body) {
        throw new Error("Empty response from S3");
      }

      // Convert stream to buffer
      const fullChunks: Buffer[] = [];
      for await (const chunk of fullResponse.Body as any) {
        fullChunks.push(Buffer.from(chunk));
      }

      const fullBuffer = Buffer.concat(fullChunks);

      // Resize the full image
      const resizedBuffer = await sharp(fullBuffer)
        .resize(400, 400, { fit: "inside" })
        .jpeg({ quality: 70 })
        .toBuffer();

      // Cache the resized image
      if (this.s3Cache.size >= this.MAX_S3_CACHE_SIZE) {
        const oldestKey = this.s3Cache.keys().next().value;
        this.s3Cache.delete(oldestKey as string);
      }

      this.s3Cache.set(key, { buffer: resizedBuffer, timestamp: now });

      return resizedBuffer;
    } catch (error) {
      console.error("Error getting image from S3:", error);
      throw new Error(`Failed to get image from S3: ${error}`);
    }
  }

  /**
   * Detect labels in an image using Rekognition with optimizations
   */
  private async detectLabels(imageData: Buffer): Promise<Label[]> {
    console.log(
      `[REKOGNITION] Starting label detection on image (${imageData.length} bytes)`,
    );

    // Use optimized parameters for faster processing
    const command = new DetectLabelsCommand({
      Image: { Bytes: imageData },
      MaxLabels: 20,
      MinConfidence: 70,
    });

    try {
      console.log(`[REKOGNITION] Sending request to AWS Rekognition`);
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
      console.error(
        `[REKOGNITION] ERROR stack: ${error instanceof Error ? error.stack : "No stack available"}`,
      );
      console.error(
        `[REKOGNITION] ERROR name: ${error instanceof Error ? error.name : "Unknown"}`,
      );
      console.log(`[REKOGNITION] Waiting 500ms before retry attempt`);

      // Check specifically for common AWS errors
      if (error instanceof Error) {
        if (error.name === "TimeoutError") {
          console.error(
            `[REKOGNITION] Timeout occurred - check network connectivity to AWS services`,
          );
        } else if (error.name === "AccessDeniedException") {
          console.error(`[REKOGNITION] Access denied - check IAM permissions`);
        } else if (error.name === "ThrottlingException") {
          console.error(`[REKOGNITION] Rate limit exceeded`);
        }
      }

      // Wait a short time before retrying once in case of rate limiting
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
        console.error(
          `[REKOGNITION] RETRY ERROR stack: ${retryError instanceof Error ? retryError.stack : "No stack available"}`,
        );
        // Return empty array instead of failing
        return [];
      }
    }
  }

  /**
   * Process detected labels to determine space type
   */
  private processLabels(labels: Label[]): ClassificationResult {
    // Track space type scores
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

    // Extract all label names
    const labelNames: string[] = [];

    // Process each label
    labels.forEach((label) => {
      if (label.Name && label.Confidence) {
        labelNames.push(label.Name);

        // Check if this label maps to a space type
        if (this.LABEL_TO_SPACE[label.Name]) {
          spaceScores[this.LABEL_TO_SPACE[label.Name]] += label.Confidence;
        }

        // Also check parent labels
        label.Parents?.forEach((parent) => {
          if (parent.Name && this.LABEL_TO_SPACE[parent.Name]) {
            // Parent matches get lower weight
            spaceScores[this.LABEL_TO_SPACE[parent.Name]] +=
              (label.Confidence || 0) * 0.5;
          }
        });
      }
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

    // If no clear match, use Other
    if (highestScore === 0) {
      bestType = SpaceType.Other;
    }

    // Calculate confidence (normalized)
    const confidenceScore = Math.min(highestScore / 1000, 0.99);

    // Create feature vector
    const featureVector: Prisma.JsonValue = {
      dimensions: Object.values(SpaceType).map((type) =>
        type === bestType ? confidenceScore : 0,
      ) as Prisma.JsonValue,
      dominantColors: this.extractColors(labels),
      detectedObjects: this.extractObjects(labels),
    };

    return {
      spaceType: bestType,
      confidenceScore,
      labels: labelNames,
      featureVector,
    };
  }

  /**
   * Extract color information from labels
   */
  private extractColors(labels: Label[]): string[] {
    const colorLabels = labels
      .filter(
        (label) =>
          label.Name?.toLowerCase().includes("color") ||
          [
            "white",
            "black",
            "red",
            "blue",
            "green",
            "yellow",
            "brown",
            "gray",
            "beige",
          ].includes(label.Name?.toLowerCase() || ""),
      )
      .sort((a, b) => (b.Confidence || 0) - (a.Confidence || 0))
      .slice(0, 3)
      .map((label) => label.Name?.toLowerCase() || "");

    return colorLabels.length ? colorLabels : ["white", "beige", "gray"];
  }

  /**
   * Extract object information from labels
   */
  private extractObjects(labels: Label[]): string[] {
    return labels
      .filter((label) => label.Confidence && label.Confidence > 80)
      .sort((a, b) => (b.Confidence || 0) - (a.Confidence || 0))
      .slice(0, 8)
      .map((label) => label.Name || "");
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
      // Add to space type score
      spaceScores[result.spaceType] += result.confidenceScore;

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

    // Calculate average confidence
    const avgConfidence = highestScore / results.length;

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
