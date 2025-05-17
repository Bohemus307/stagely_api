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
import { SpaceClassificationService } from "../../properties/spaces/classification";
import { ImageProcessor } from "../../properties/spaces/classification/imageProcessor";
import {
  S3Config,
  IncidentDetectionResult,
  ComparisonConfig,
  DetectedChange,
  DetectedLabel,
  BoundingBox,
} from "./comparisonTypes";
import { ImageComparisonProcessor } from "./imageComparison";
import { IncidentLabelProcessor } from "./incidentLabelProcessor";
import { SeverityAssessor } from "./severityAssesor";

/**
 * Service for detecting incidents and comparing images
 */
export class IncidentClassificationService {
  private rekognition: RekognitionClient;
  private s3Config: S3Config;
  private imageProcessor: ImageProcessor;
  private labelProcessor: IncidentLabelProcessor;
  private comparisonProcessor: ImageComparisonProcessor;
  private severityAssessor: SeverityAssessor;
  private spaceClassifier: SpaceClassificationService;

  constructor(
    s3Config: S3Config,
    comparisonConfig?: Partial<ComparisonConfig>,
  ) {
    console.log(`[INIT] Initializing IncidentClassificationService`);
    console.log(`[INIT] AWS Region: ${s3Config.region}`);

    this.rekognition = new RekognitionClient({
      region: s3Config.region,
      requestHandler: {
        timeoutInMs: 15000, // 15 second timeout
      } as any,
    });

    this.s3Config = s3Config;
    this.imageProcessor = new ImageProcessor(s3Config.client, s3Config.bucket);
    this.labelProcessor = new IncidentLabelProcessor();
    this.comparisonProcessor = new ImageComparisonProcessor(comparisonConfig);
    this.severityAssessor = new SeverityAssessor();
    this.spaceClassifier = new SpaceClassificationService(s3Config);

    console.log(
      `[INIT] IncidentClassificationService initialized successfully`,
    );
  }

  /**
   * Detect incidents by analyzing a new image and comparing it with previous images
   */
  async detectIncidents(
    newImage: PropertyImage,
    previousImages: PropertyImage[] = [],
    propertyId?: number,
    userId?: string,
  ): Promise<IncidentDetectionResult> {
    console.log(
      `[INCIDENT-DETECT] Starting incident detection for image: ${newImage.id}`,
    );
    const startTime = Date.now();

    try {
      // Get optimized image data for the new image
      const imageKey = this.imageProcessor.extractS3Key(newImage.imageUrl);
      const imageData =
        await this.imageProcessor.getOptimizedImageFromS3(imageKey);

      // Detect labels in the new image
      const newImageLabels = await this.detectLabels(imageData);

      // Process labels to identify potential incidents
      const {
        incidentType,
        severity: initialSeverity,
        confidence,
        detectedLabels,
      } = this.labelProcessor.processLabelsForIncidents(newImageLabels);

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
        const previousImageKey = this.imageProcessor.extractS3Key(
          mostRecentImage.imageUrl,
        );
        const previousImageData =
          await this.imageProcessor.getOptimizedImageFromS3(previousImageKey);
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

      // Generate labeled image if propertyId and userId are provided and there are labels to show
      let labeledImageUrl: string | undefined;
      if (propertyId && userId && detectedLabels.length > 0) {
        try {
          console.log(
            `[INCIDENT-DETECT] Generating labeled image for propertyId=${propertyId}, userId=${userId}`,
          );
          labeledImageUrl = await this.imageProcessor.drawBoundingBoxesOnImage(
            imageKey,
            detectedLabels,
            propertyId,
            userId,
          );
        } catch (imageError) {
          console.error(
            "[INCIDENT-DETECT] Error generating labeled image:",
            imageError,
          );
          // Continue without labeled image if generation fails
        }
      } else {
        console.log(
          `[INCIDENT-DETECT] Not generating labeled image: propertyId=${propertyId}, userId=${userId}, labels=${detectedLabels.length}`,
        );
      }

      // Create final result
      const result: IncidentDetectionResult = {
        incidentType: finalIncidentType,
        severity: finalSeverity,
        confidenceScore: confidence,
        spaceType: spaceClassification.spaceType,
        detectedLabels,
        changes,
        featureVector,
        labeledImageUrl, // Include the labeled image URL if available
      };

      const totalTime = Date.now() - startTime;
      console.log(
        `[INCIDENT-DETECT] Detection completed in ${totalTime}ms. Result: Type=${finalIncidentType}, Severity=${finalSeverity}, Changes=${changes.length}, LabeledImage=${labeledImageUrl ? "Yes" : "No"}`,
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
        console.log(`[REKOGNITION] Retrying label detection`);
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

    return this.detectIncidents(newImage, previousImages);
  }
}
