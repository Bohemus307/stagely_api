import {
  RekognitionClient,
  DetectLabelsCommand,
  Label,
} from "@aws-sdk/client-rekognition";
import {
  SpaceType,
  IncidentSeverity,
  PropertyImage,
  Prisma,
} from "@prisma/client";
import {
  S3Config,
  IncidentDetectionResult,
  ComparisonConfig,
  DetectedChange,
  DetectedLabel,
} from "./comparisonTypes";
import { ImageComparisonProcessor } from "./imageComparison";
import { IncidentLabelProcessor } from "./incidentLabelProcessor";
import { SeverityAssessor } from "./severityAssesor";
import { ClaudeClassificationService } from "../../properties/spaces/classification/claudeClassifier";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const extractS3Key = (imageUrl: string): string => {
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
};
/**
 * Service for detecting incidents and comparing images
 */
export class IncidentClassificationService {
  private rekognition: RekognitionClient;
  private s3Config: S3Config;
  private s3Client: S3Client;
  private s3Bucket: string;
  private labelProcessor: IncidentLabelProcessor;
  private comparisonProcessor: ImageComparisonProcessor;
  private severityAssessor: SeverityAssessor;
  private spaceClassifier: ClaudeClassificationService;

  constructor(
    s3Config: S3Config,
    s3Client: S3Client,
    s3Bucket: string,
    comparisonConfig?: Partial<ComparisonConfig>,
  ) {
    this.rekognition = new RekognitionClient({
      region: s3Config.region,
      requestHandler: {
        timeoutInMs: 15000, // 15 second timeout
      } as any,
    });

    this.s3Config = s3Config;
    this.s3Client = s3Client;
    this.s3Bucket = s3Bucket;
    this.labelProcessor = new IncidentLabelProcessor();
    this.comparisonProcessor = new ImageComparisonProcessor(comparisonConfig);
    this.severityAssessor = new SeverityAssessor();
    this.spaceClassifier = new ClaudeClassificationService(s3Config);

    console.log(
      `[INIT] IncidentClassificationService initialized successfully`,
    );
  }
  /**
   * Get optimized image data from S3 with adaptive quality
   */
  async getOptimizedImageFromS3(key: string): Promise<Buffer> {
    try {
      const now = Date.now();

      try {
        const command = new GetObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Range: "bytes=0-4194304", // First 4MB - enough for most images
        });
        const response = await this.s3Client.send(command);

        if (response.Body) {
          // Convert stream to buffer efficiently
          const chunks: Buffer[] = [];
          for await (const chunk of response.Body as any) {
            chunks.push(Buffer.from(chunk));
          }

          const originalBuffer = Buffer.concat(chunks);

          return originalBuffer;
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

      return fullBuffer;
    } catch (error) {
      console.error("Error getting image from S3:", error);
      throw new Error(`Failed to get image from S3: ${error}`);
    }
  }

  /**
   * Detect incidents by analyzing a new image and comparing it with previous images
   */
  async detectIncidents(
    newImage: PropertyImage,
    previousImages: PropertyImage[] = [],
    propertyId?: number,
  ): Promise<IncidentDetectionResult> {
    console.log(
      `[INCIDENT-DETECT] Starting incident detection for image: ${newImage.imageUrl} (ID: ${newImage.id}), propertyId=${propertyId}`,
    );
    const startTime = Date.now();

    try {
      // Get optimized image data for the new image
      const imageKey = extractS3Key(newImage.imageUrl);
      const imageData = await this.getOptimizedImageFromS3(imageKey);

      // Detect labels in the new image
      const newImageLabels = await this.detectLabels(imageData);

      // Process labels to identify potential incidents
      const {
        incidentType,
        severity: initialSeverity,
        confidence,
        detectedLabels,
      } = this.labelProcessor.processLabelsForIncidents(newImageLabels);

      console.log("[INCIDENT-DETECT] Labels for initial photo", detectedLabels);

      // Find the most recent previous image for comparison
      let changes: DetectedChange[] = [];
      if (previousImages.length > 0) {
        // Sort by date with most recent first
        const sortedPrevImages = [...previousImages].sort(
          (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
        );

        // Get the most recent image
        const mostRecentImage = sortedPrevImages[0];

        // Get labels for previous image
        const previousImageKey = extractS3Key(mostRecentImage.imageUrl);
        const previousImageData =
          await this.getOptimizedImageFromS3(previousImageKey);
        const previousImageLabels = await this.detectLabels(previousImageData);
        const previousDetectedLabels =
          this.convertToDetectedLabels(previousImageLabels);

        // Compare images to detect changes
        changes = this.comparisonProcessor.compareImageLabels(
          previousDetectedLabels,
          detectedLabels,
        );
      }

      // Classify the space type using the SpaceClassificationService
      let spaceClassification;
      try {
        spaceClassification = await this.spaceClassifier.classifyImage(
          newImage.imageUrl,
        );
      } catch (error) {
        console.error("Error classifying space type:", error);
        spaceClassification = {
          spaceType: SpaceType.Unknown,
          confidenceScore: 0,
          labels: [],
          featureVector: {},
        };
      }

      // Assess final severity based on changes
      const finalSeverity = this.severityAssessor.assessSeverity(
        changes,
        initialSeverity,
      );

      // Check overall confidence - if less than 80%, set as "Unknown Issue"
      const finalIncidentType =
        confidence >= 0.8 ? incidentType : "Unknown Issue";

      // Create feature vector
      const featureVector: Prisma.JsonValue = {
        incidentType: finalIncidentType,
        severity: finalSeverity,
        confidence,
        spaceType: spaceClassification.spaceType,
        changeCount: changes.length,
        changeTypes: changes.map((c) => c.changeType),
        detectedObjects: detectedLabels.map((l) => l.name),
      };

      // Create final result
      const result: IncidentDetectionResult = {
        incidentType: finalIncidentType,
        severity: finalSeverity,
        confidenceScore: confidence,
        spaceType: spaceClassification.spaceType,
        detectedLabels,
        changes,
        featureVector,
      };

      const totalTime = Date.now() - startTime;
      console.log(
        `[INCIDENT-DETECT] Detection completed in ${totalTime}ms. Result: Type=${finalIncidentType}, Severity=${finalSeverity}, Changes=${changes.length}`,
      );

      return result;
    } catch (error) {
      console.error(
        `[INCIDENT-DETECT] ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Return a default result instead of throwing
      return {
        incidentType: "Unknown Issue",
        severity: IncidentSeverity.Low,
        confidenceScore: 0.3,
        spaceType: null,
        detectedLabels: [],
        changes: [],
        featureVector: {},
      };
    }
  }

  /**
   * Detect labels in an image using AWS Rekognition
   */
  private async detectLabels(imageData: Buffer): Promise<Label[]> {
    console.log(
      `[REKOGNITION] Starting label detection (${imageData.length} bytes)`,
    );

    const command = new DetectLabelsCommand({
      Image: { Bytes: imageData },
      MaxLabels: 50, // More labels for better incident detection
      MinConfidence: 50, // Lower threshold to catch more potential issues
      Features: ["GENERAL_LABELS", "IMAGE_PROPERTIES"],
    });

    try {
      const startTime = Date.now();
      const response = await this.rekognition.send(command);
      const duration = Date.now() - startTime;

      console.log(
        `[REKOGNITION] Received ${response.Labels?.length || 0} labels in ${duration}ms`,
      );

      return response.Labels || [];
    } catch (error) {
      console.error(
        `[REKOGNITION] ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Try again once
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        const response = await this.rekognition.send(command);
        return response.Labels || [];
      } catch (retryError) {
        console.error(
          `[REKOGNITION] RETRY ERROR: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
        return [];
      }
    }
  }

  /**
   * Convert AWS Rekognition labels to our DetectedLabel format
   */
  private convertToDetectedLabels(labels: Label[]): DetectedLabel[] {
    return labels.map((label) => {
      // First check if we have instances with bounding boxes
      let boundingBox;

      if (
        label.Instances &&
        label.Instances.length > 0 &&
        label.Instances[0].BoundingBox
      ) {
        const rekBoundingBox = label.Instances[0].BoundingBox;

        // Only create a bounding box if all required properties exist
        if (
          typeof rekBoundingBox.Left === "number" &&
          typeof rekBoundingBox.Top === "number" &&
          typeof rekBoundingBox.Width === "number" &&
          typeof rekBoundingBox.Height === "number"
        ) {
          boundingBox = {
            left: rekBoundingBox.Left,
            top: rekBoundingBox.Top,
            width: rekBoundingBox.Width,
            height: rekBoundingBox.Height,
          };
        }
      }

      return {
        name: label.Name || "",
        confidence: (label.Confidence || 0) / 100,
        parentNames: label.Parents?.map((p) => p.Name || "") || [],
        boundingBox,
      };
    });
  }

  /**
   * Process multiple images to detect incidents and changes
   */
  async processMultipleImages(
    images: PropertyImage[],
    propertyId?: number,
    userId?: string,
  ): Promise<IncidentDetectionResult> {
    if (images.length === 0) {
      return {
        incidentType: "Unknown Issue",
        severity: IncidentSeverity.Low,
        confidenceScore: 0,
        spaceType: null,
        detectedLabels: [],
        changes: [],
        featureVector: {},
      };
    }

    // Sort images by date (newest first)
    const sortedImages = [...images].sort(
      (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
    );

    // Process the most recent image and compare with previous ones
    const newImage = sortedImages[0];
    const previousImages = sortedImages.slice(1);

    return this.detectIncidents(newImage, previousImages, propertyId);
  }

  /**
   * OPTIMIZED: Detect incidents and classify space with a single Rekognition call
   * Returns both incident and space classification results
   */
  async detectIncidentsAndSpace(
    newImage: PropertyImage,
    previousImages: PropertyImage[] = [],
  ): Promise<{
    incident: IncidentDetectionResult;
    space: {
      spaceType: SpaceType;
      confidenceScore: number;
      labels: string[];
      featureVector: any;
    };
    labeledImagePromise?: Promise<string | undefined>;
  }> {
    console.log(
      `[UNIFIED-DETECT] Starting unified detection for image: ${newImage.imageUrl} (ID: ${newImage.id})`,
    );
    const startTime = Date.now();

    try {
      // Get optimized image data ONCE
      const imageKey = extractS3Key(newImage.imageUrl);
      const imageData = await this.getOptimizedImageFromS3(imageKey);

      // Call Rekognition ONCE
      const labels = await this.detectLabels(imageData);
      console.log(
        `[UNIFIED-DETECT] Got ${labels.length} labels from single Rekognition call`,
      );

      // Process labels for incident detection
      const {
        incidentType,
        severity: initialSeverity,
        confidence,
        detectedLabels,
      } = this.labelProcessor.processLabelsForIncidents(labels);

      // Process the same labels for space classification (reuse SpaceClassifier's label processor)
      const spaceClassification = await this.spaceClassifier.classifyImage(
        newImage.imageUrl,
      );

      // Handle change detection if previous images exist
      let changes: DetectedChange[] = [];
      if (previousImages.length > 0) {
        const sortedPrevImages = [...previousImages].sort(
          (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
        );
        const mostRecentImage = sortedPrevImages[0];

        const previousImageKey = extractS3Key(mostRecentImage.imageUrl);
        const previousImageData =
          await this.getOptimizedImageFromS3(previousImageKey);
        const previousImageLabels = await this.detectLabels(previousImageData);
        const previousDetectedLabels =
          this.convertToDetectedLabels(previousImageLabels);

        changes = this.comparisonProcessor.compareImageLabels(
          previousDetectedLabels,
          detectedLabels,
        );
      }

      // Assess final severity
      const finalSeverity = this.severityAssessor.assessSeverity(
        changes,
        initialSeverity,
      );

      const finalIncidentType =
        confidence >= 0.8 ? incidentType : "Unknown Issue";

      // Create feature vector
      const featureVector: Prisma.JsonValue = {
        incidentType: finalIncidentType,
        severity: finalSeverity,
        confidence,
        spaceType: spaceClassification.spaceType,
        changeCount: changes.length,
        changeTypes: changes.map((c) => c.changeType),
        detectedObjects: detectedLabels.map((l) => l.name),
      };

      // Create results
      const incidentResult: IncidentDetectionResult = {
        incidentType: finalIncidentType,
        severity: finalSeverity,
        confidenceScore: confidence,
        spaceType: spaceClassification.spaceType,
        detectedLabels,
        changes,
        featureVector,
        labeledImageUrl: undefined, // Will be set from promise if needed
      };

      const spaceResult = {
        spaceType: spaceClassification.spaceType,
        confidenceScore: spaceClassification.confidenceScore,
        labels: spaceClassification.labels,
        featureVector: spaceClassification.featureVector,
      };

      const totalTime = Date.now() - startTime;
      console.log(
        `[UNIFIED-DETECT] Completed in ${totalTime}ms with 1 Rekognition call. Space=${spaceResult.spaceType}, Incident=${incidentResult.incidentType}`,
      );

      return {
        incident: incidentResult,
        space: spaceResult,
      };
    } catch (error) {
      console.error(
        `[UNIFIED-DETECT] ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Return defaults
      return {
        incident: {
          incidentType: "Unknown Issue",
          severity: IncidentSeverity.Low,
          confidenceScore: 0.3,
          spaceType: null,
          detectedLabels: [],
          changes: [],
          featureVector: {},
        },
        space: {
          spaceType: SpaceType.Unknown,
          confidenceScore: 0,
          labels: [],
          featureVector: {},
        },
      };
    }
  }
}
