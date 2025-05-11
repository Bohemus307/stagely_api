import {
  PrismaClient,
  Incident,
  IncidentStatus,
  IncidentSeverity,
  Prisma,
  SpaceType,
  PropertyImage,
} from "@prisma/client";
import {
  IncidentRepository,
  IncidentQueryParams,
  PaginatedResponse,
  IncidentWithRelations,
  IncidentWithFullRelations,
  IncidentStats,
} from "../../repositories/incidentRepository";
import { ConflictError, NotFoundError } from "../../utils/errors";
import { S3Client } from "@aws-sdk/client-s3";
import { SpaceClassificationResult } from "../../repositories/propertySpacesRepository";
import { SpaceClassificationService } from "../properties/spaces/classification";
import { IncidentClassificationService } from "./comparison";
import { S3Config } from "./comparison/comparisonTypes";

// Define incident create/update input types with specific types
export interface CreateIncidentInput {
  propertyId: number;
  incidentType: string;
  description: string;
  reportedAt?: Date | string;
  severity: IncidentSeverity;
  status?: IncidentStatus;
  images?: {
    imageUrl: string;
    caption?: string;
    takenAt?: Date | string;
  }[];
}

export interface UpdateIncidentInput {
  incidentType?: string;
  description?: string;
  reportedAt?: Date | string;
  resolvedAt?: Date | string | null;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  images?: {
    id?: number;
    imageUrl: string;
    caption?: string;
    takenAt?: Date | string;
  }[];
}

/**
 * Service for incident-related business logic
 */
export class IncidentService {
  private incidentRepo: IncidentRepository;
  private s3: { client: S3Client; bucket: string; region: string };
  private spaceClassificationService: SpaceClassificationService;
  private incidentClassificationService: IncidentClassificationService;

  constructor(
    prisma: PrismaClient,
    s3: { client: S3Client; bucket: string; region: string },
  ) {
    this.incidentRepo = new IncidentRepository(prisma, s3);
    this.s3 = s3;
    this.spaceClassificationService = new SpaceClassificationService(s3);

    // Initialize the new incident classification service
    const s3Config: S3Config = {
      client: s3.client,
      bucket: s3.bucket,
      region: s3.region,
    };
    this.incidentClassificationService = new IncidentClassificationService(
      s3Config,
    );
  }

  /**
   * Get incidents with pagination and filtering
   */
  async getIncidents(
    queryParams: IncidentQueryParams,
  ): Promise<PaginatedResponse<IncidentWithRelations>> {
    return this.incidentRepo.getIncidents(queryParams);
  }

  /**
   * Get an incident by ID
   */
  async getIncidentById(id: number): Promise<IncidentWithFullRelations> {
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    return incident;
  }

  /**
   * Create a new incident
   */
  async createIncident(data: CreateIncidentInput): Promise<Incident> {
    const { images, ...incidentData } = data;

    const finalData = {
      ...incidentData,
      status: data.status || IncidentStatus.Open,
      reportedAt: data.reportedAt ? new Date(data.reportedAt) : new Date(),
      resolvedAt: null,
    };

    // Using the standard createIncident method
    const incident = await this.incidentRepo.createIncident(finalData);

    // Add images if provided and classify the incident based on them
    if (images && images.length > 0) {
      // First, add images to the incident
      const addedImages = await this.incidentRepo.addIncidentImages(
        incident.id,
        images.map((img) => ({
          ...img,
          takenAt: img.takenAt ? new Date(img.takenAt) : new Date(),
        })),
      );

      // Now use classification service to analyze the images and classify the incident
      if (addedImages.length > 0) {
        try {
          // Convert the added images to PropertyImage type expected by classification service
          const propertyImages = addedImages.map((img) => ({
            ...img,
            id: img.id,
            imageUrl: img.imageUrl,
            takenAt: img.takenAt || new Date(),
          })) as PropertyImage[];

          // Detect incidents using the classification service
          const detectionResult =
            await this.incidentClassificationService.processMultipleImages(
              propertyImages,
            );

          // Update incident with classification results // more to come now
          await this.incidentRepo.updateIncident(incident.id, {
            incidentType: detectionResult.incidentType || incident.incidentType,
            severity: detectionResult.severity || incident.severity,
            spaceType: (detectionResult.spaceType as SpaceType) || undefined,
            featureVector: detectionResult.featureVector || Prisma.JsonNull,
            aiClassified: true,
          });
        } catch (error) {
          console.error("Error classifying incident:", error);
          // Continue even if classification fails
        }
      }
    }

    return this.getIncidentById(incident.id);
  }

  /**
   * Update an incident
   */
  async updateIncident(
    id: number,
    data: UpdateIncidentInput,
  ): Promise<Incident> {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    // Handle dates
    const parsedData = {
      ...data,
      reportedAt: data.reportedAt ? new Date(data.reportedAt) : undefined,
      resolvedAt:
        data.resolvedAt === null
          ? null
          : data.resolvedAt
            ? new Date(data.resolvedAt)
            : undefined,
    };

    // Handle image updates separately if provided
    const { images, ...incidentData } = parsedData;

    // Update the incident
    await this.incidentRepo.updateIncidentStatus(
      id,
      incidentData.status || incident.status,
      incidentData.resolvedAt,
    );

    // If there are any images to add
    if (images && images.length > 0) {
      const newImages = images.filter((img) => !img.id);

      if (newImages.length > 0) {
        const addedImages = await this.incidentRepo.addIncidentImages(
          id,
          newImages.map((img) => ({
            imageUrl: img.imageUrl,
            caption: img.caption,
            takenAt: img.takenAt ? new Date(img.takenAt) : new Date(),
          })),
        );

        // If new images were added, reclassify the incident
        if (addedImages.length > 0) {
          try {
            // Get all images for this incident
            const allImages = await this.incidentRepo.getIncidentImages(id);

            // Convert to PropertyImage type
            const propertyImages = allImages.map((img) => ({
              ...img,
              id: img.id,
              imageUrl: img.imageUrl,
              takenAt: img.takenAt,
            })) as PropertyImage[];

            // Reclassify based on all images (including new ones)
            const detectionResult =
              await this.incidentClassificationService.processMultipleImages(
                propertyImages,
              );

            // Update incident with classification results
            await this.incidentRepo.updateIncident(id, {
              incidentType:
                detectionResult.incidentType || incident.incidentType,
              severity: detectionResult.severity || incident.severity,
              spaceType: (detectionResult.spaceType as SpaceType) || undefined,
              featureVector: detectionResult.featureVector || Prisma.JsonNull,
              aiClassified: true,
            });
          } catch (error) {
            console.error(
              "Error reclassifying incident after adding images:",
              error,
            );
            // Continue even if reclassification fails
          }
        }
      }
    }

    return this.getIncidentById(id);
  }

  /**
   * Change incident status
   */
  async changeIncidentStatus(
    id: number,
    status: IncidentStatus,
    resolvedAt?: Date | string | null,
  ): Promise<Incident> {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    // Parse date if provided
    const parsedResolvedAt = resolvedAt
      ? resolvedAt === null
        ? null
        : new Date(resolvedAt)
      : status === IncidentStatus.Resolved || status === IncidentStatus.Closed
        ? new Date()
        : null;

    return this.incidentRepo.updateIncidentStatus(id, status, parsedResolvedAt);
  }

  /**
   * Delete an incident
   */
  async deleteIncident(id: number): Promise<{ success: boolean; id: number }> {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    return this.incidentRepo.deleteIncident(id);
  }

  /**
   * Get incident statistics
   */
  async getIncidentStats(propertyId?: number): Promise<IncidentStats> {
    return this.incidentRepo.getIncidentStats(propertyId);
  }

  /**
   * Add images to an incident
   */
  async addIncidentImages(
    id: number,
    images: {
      imageUrl: string;
      caption?: string;
      takenAt?: Date | string;
    }[],
  ) {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    const addedImages = await this.incidentRepo.addIncidentImages(
      id,
      images.map((img) => ({
        ...img,
        takenAt: img.takenAt ? new Date(img.takenAt) : new Date(),
      })),
    );

    // After adding images, reclassify the incident
    if (addedImages.length > 0) {
      try {
        // Get all images for this incident
        const allImages = await this.incidentRepo.getIncidentImages(id);

        // Convert to PropertyImage type
        const propertyImages = allImages.map((img) => ({
          ...img,
          id: img.id,
          imageUrl: img.imageUrl,
          takenAt: img.takenAt,
        })) as PropertyImage[];

        // Reclassify based on all images (including new ones)
        const detectionResult =
          await this.incidentClassificationService.processMultipleImages(
            propertyImages,
          );

        // Update incident with classification results
        await this.incidentRepo.updateIncident(id, {
          incidentType: detectionResult.incidentType || incident.incidentType,
          severity: detectionResult.severity || incident.severity,
          spaceType: (detectionResult.spaceType as SpaceType) || undefined,
          featureVector: detectionResult.featureVector || Prisma.JsonNull,
          aiClassified: true,
        });
      } catch (error) {
        console.error("Error classifying incident after adding images:", error);
        // Continue even if classification fails
      }
    }

    return addedImages;
  }

  /**
   * Group images by their likely space types using preliminary classification
   */
  private async groupImagesBySpaceType(
    images: PropertyImage[],
  ): Promise<Record<SpaceType, PropertyImage[]>> {
    // Initialize result with empty arrays for each space type
    const result: Record<SpaceType, PropertyImage[]> = {} as any;
    Object.values(SpaceType).forEach((type) => {
      result[type] = [];
    });

    // Create classification service
    const classificationService = new SpaceClassificationService(this.s3);

    // Classify each image individually
    for (const image of images) {
      try {
        const classification = await classificationService.classifyImage(
          image.imageUrl,
        );
        result[classification.spaceType].push(image);
      } catch (error) {
        console.error(`Error classifying image ${image.id}:`, error);
        // Add to Unknown category if classification fails
        result[SpaceType.Unknown].push(image);
      }
    }

    return result;
  }

  /**
   * Categorize an object based on its name
   */
  private categorizeObject(objectName: string): string | undefined {
    // Define categories and their objects
    const categories: Record<string, string[]> = {
      Furniture: [
        "Sofa",
        "Chair",
        "Table",
        "Bed",
        "Dresser",
        "Nightstand",
        "Couch",
        "Desk",
        "Bench",
        "Ottoman",
        "Stool",
        "Bookcase",
        "Shelf",
      ],
      Appliances: [
        "Refrigerator",
        "Oven",
        "Microwave",
        "Dishwasher",
        "Washing Machine",
        "Dryer",
        "Stove",
        "Range",
        "Toaster",
        "Blender",
        "Coffee Maker",
      ],
      Fixtures: [
        "Sink",
        "Toilet",
        "Bathtub",
        "Shower",
        "Light",
        "Lamp",
        "Faucet",
        "Mirror",
        "Ceiling Fan",
        "Chandelier",
      ],
      Electronics: [
        "Television",
        "TV",
        "Computer",
        "Laptop",
        "Monitor",
        "Speaker",
        "Stereo",
        "Phone",
        "Camera",
      ],
      Storage: [
        "Cabinet",
        "Shelf",
        "Wardrobe",
        "Closet",
        "Drawer",
        "Chest",
        "Trunk",
        "Box",
        "Container",
        "Basket",
      ],
      Architectural: [
        "Wall",
        "Floor",
        "Ceiling",
        "Window",
        "Door",
        "Stairs",
        "Railing",
        "Porch",
        "Deck",
        "Patio",
        "Balcony",
      ],
    };

    // Convert object name to lowercase for case-insensitive matching
    const name = objectName.toLowerCase();

    // Check each category
    for (const [category, objects] of Object.entries(categories)) {
      if (
        objects.some(
          (obj) =>
            name.includes(obj.toLowerCase()) ||
            obj.toLowerCase().includes(name),
        )
      ) {
        return category;
      }
    }

    return undefined;
  }

  /**
   * Extract object labels from classification result
   */
  private extractObjectLabels(
    classificationResult: any,
  ): Array<{ name: string; confidence: number; category?: string }> {
    const objectLabels: Array<{
      name: string;
      confidence: number;
      category?: string;
    }> = [];

    // Extract detected objects from the feature vector
    const featureVector = classificationResult.featureVector as any;

    if (
      featureVector?.detectedObjects &&
      Array.isArray(featureVector.detectedObjects)
    ) {
      featureVector.detectedObjects.forEach((objectName: string) => {
        objectLabels.push({
          name: objectName,
          confidence: 0.9, // High confidence for detected objects
          category: this.categorizeObject(objectName),
        });
      });
    }

    // Add labels if they aren't already included as objects
    if (
      classificationResult.labels &&
      Array.isArray(classificationResult.labels)
    ) {
      classificationResult.labels.forEach((label: string) => {
        // Don't add duplicates
        if (
          !objectLabels.some(
            (obj) => obj.name.toLowerCase() === label.toLowerCase(),
          )
        ) {
          objectLabels.push({
            name: label,
            confidence: 0.75, // Lower confidence for general labels
            category: this.categorizeObject(label),
          });
        }
      });
    }

    return objectLabels;
  }

  /**
   * Bulk upload images to an incident
   */
  async bulkUploadIncidentImages(
    incidentId: number,
    images: {
      imageUrl: string;
      caption?: string | null;
      takenAt: Date;
      metadata?: any | null;
    }[],
  ): Promise<PropertyImage[]> {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(incidentId);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${incidentId} not found`);
    }

    // Process each image one by one
    const uploadedImages: PropertyImage[] = [];

    for (const image of images) {
      const uploadedImage = await this.incidentRepo.uploadIncidentImage({
        incidentId: incident.id,
        imageUrl: image.imageUrl,
        caption: image.caption,
        takenAt: image.takenAt,
        metadata: image.metadata,
      });

      uploadedImages.push(uploadedImage);
    }

    // After adding images, reclassify the incident
    if (uploadedImages.length > 0) {
      try {
        // Get all images for this incident
        const allImages = await this.incidentRepo.getIncidentImages(incidentId);

        // Convert to PropertyImage type
        const propertyImages = allImages.map((img) => ({
          ...img,
          id: img.id,
          imageUrl: img.imageUrl,
          takenAt: img.takenAt,
        })) as PropertyImage[];

        // Detect incidents using the classification service
        const detectionResult =
          await this.incidentClassificationService.processMultipleImages(
            propertyImages,
          );

        // Update incident with classification results
        await this.incidentRepo.updateIncident(incidentId, {
          incidentType: detectionResult.incidentType || incident.incidentType,
          severity: detectionResult.severity || incident.severity,
          spaceType: (detectionResult.spaceType as SpaceType) || undefined,
          featureVector: detectionResult.featureVector || Prisma.JsonNull,
          aiClassified: true,
        });
      } catch (error) {
        console.error(
          "Error classifying incident after bulk uploading images:",
          error,
        );
        // Continue even if classification fails
      }
    }

    return uploadedImages;
  }

  /**
   * Automatically create spaces and classify images using AI
   * Also saves object labels detected in the images
   */
  async autoCreateAndClassifyIncident(
    propertyId: number,
    imageIds: number[],
  ): Promise<SpaceClassificationResult[]> {
    // Validate property exists and get images (concurrent)
    const [propertyExists, images] = await Promise.all([
      this.incidentRepo.propertyExists(propertyId),
      this.incidentRepo.getImagesByIds(imageIds),
    ]);

    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    // If no images, return empty result
    if (images.length === 0) {
      return [];
    }

    // Create the classification service
    const classificationService = new SpaceClassificationService(this.s3);

    // Get all image URLs
    const imageUrls = images.map((img: { imageUrl: any }) => img.imageUrl);

    // Process ALL images at once using our optimized service
    // The service internally handles controlled concurrency
    const results =
      await classificationService.classifyMultipleImages(imageUrls);

    // Group images by AI-determined space type
    const imagesByType = await this.groupImagesBySpaceType(images);

    // Create spaces for each type concurrently
    const createSpacePromises = Object.entries(imagesByType).map(
      async ([spaceType, groupImages]) => {
        // Skip if no images for this type
        if (groupImages.length === 0) return null;

        try {
          // Extract object labels from the classification results
          const objectLabels = this.extractObjectLabels(results);

          // Convert group images to PropertyImage[] for incident classification
          const propertyImages = groupImages as PropertyImage[];

          // Use the incident classification service to determine incident type and severity
          const detectionResult =
            await this.incidentClassificationService.processMultipleImages(
              propertyImages,
            );

          // Create a incident with incident classification results
          const incidentName = `${spaceType} ${new Date().toISOString().slice(0, 10)}`;
          const newIncident = await this.incidentRepo.createIncident({
            propertyId,
            incidentType: detectionResult.incidentType || spaceType.toString(),
            description: incidentName,
            reportedAt: new Date(),
            severity: detectionResult.severity || IncidentSeverity.Low,
            status: IncidentStatus.Open,
            spaceType: spaceType as SpaceType,
            featureVector: detectionResult.featureVector || Prisma.JsonNull,
            aiClassified: true,
            resolvedAt: null,
          });

          // Save the object labels if we have any
          if (objectLabels.length > 0) {
            await this.incidentRepo.addObjectLabelsToSpace(
              newIncident.id,
              objectLabels,
            );
          }

          // Get IDs of images in this group
          const groupImageIds = groupImages.map((img) => img.id);

          // Associate images with the new space
          await this.incidentRepo.associateImagesWithIncident(
            newIncident.id,
            groupImageIds,
          );

          // Create the result (with optional objectLabels field)
          const result: SpaceClassificationResult = {
            incidentId: newIncident.id,
            spaceType: spaceType as SpaceType,
            confidenceScore: new Prisma.Decimal(
              Number(
                detectionResult.confidenceScore || results.confidenceScore,
              ).toFixed(4),
            ),
            featureVector:
              detectionResult.featureVector || results.featureVector,
          };

          // Add object labels if we have any
          if (objectLabels.length > 0) {
            result.objectLabels = objectLabels.map(
              (label: { name: any }) => label.name,
            );
          }

          return result;
        } catch (error) {
          console.error(`Error processing space type ${spaceType}:`, error);
          return null;
        }
      },
    );

    // Wait for all space processing to complete and filter out null results
    const spaceResults = await Promise.all(createSpacePromises);

    // Fix the type predicate to match SpaceClassificationResult
    return spaceResults.filter(
      (result): result is SpaceClassificationResult => result !== null,
    );
  }

  /**
   * Create a incident from an image URL by:
   * 1. Creating a temporary incident
   * 2. Uploading the image to this space
   * 3. Classifying the image
   * 4. Creating the incident based on classification
   */
  async createIncidentFromImage(
    propertyId: number,
    imageUrl: string,
    userId: string,
    metadata?: any,
  ): Promise<IncidentWithFullRelations> {
    // Check if property exists
    const propertyExists = await this.incidentRepo.propertyExists(propertyId);
    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    // Create a temporary space to associate with the image
    const tempSpace = await this.incidentRepo.createIncident({
      propertyId,
      incidentType: "Temporary",
      description: `Temp ${new Date().toISOString()}`,
      reportedAt: new Date(),
      resolvedAt: null,
      severity: IncidentSeverity.Low,
      status: IncidentStatus.Open,
      spaceType: SpaceType.Unknown,
      aiClassified: true,
      featureVector: Prisma.JsonNull,
    });

    try {
      // Upload the image using the existing bulkUploadSpaceImages method
      const currentDate = new Date();
      const uploadedImages = await this.bulkUploadIncidentImages(tempSpace.id, [
        {
          imageUrl,
          takenAt: currentDate,
          metadata,
        },
      ]);

      if (uploadedImages.length === 0) {
        throw new ConflictError("Failed to upload image");
      }

      const propertyImage = uploadedImages[0];

      // Use both classification services together
      // 1. First classify the image with space classification
      const spaceClassification =
        await this.spaceClassificationService.classifyImage(imageUrl);

      // 2. Then use incident classification to detect issues
      console.log(
        `[SERVICE] Detecting incidents with propertyId=${propertyId}, userId=${userId}`,
      );
      const incidentClassification =
        await this.incidentClassificationService.detectIncidents(
          propertyImage as PropertyImage,
          [], // No previous images
          propertyId, // Pass property ID
          userId, // Pass user ID
        );

      console.log(
        `[SERVICE] Incident classification result: ${JSON.stringify({
          type: incidentClassification.incidentType,
          severity: incidentClassification.severity,
          labeledImageUrl: incidentClassification.labeledImageUrl
            ? "present"
            : "missing",
        })}`,
      );

      // 3. Create a properly classified incident with combined results
      const newIncident = await this.incidentRepo.createIncident({
        propertyId,
        incidentType: incidentClassification.incidentType || "Unknown Issue",
        description: `Incident in ${spaceClassification.spaceType} - ${new Date().toISOString().slice(0, 10)}`,
        reportedAt: new Date(),
        resolvedAt: null,
        severity: incidentClassification.severity || IncidentSeverity.Low,
        status: IncidentStatus.Open,
        spaceType: spaceClassification.spaceType,
        featureVector: incidentClassification.featureVector || Prisma.JsonNull,
        aiClassified: true,
        labeledImageUrl: incidentClassification.labeledImageUrl,
      });

      // 4. Associate the image with the new incident
      await this.incidentRepo.associateImagesWithIncident(newIncident.id, [
        propertyImage.id,
      ]);

      // Delete the temporary space as we now have a properly classified one
      await this.deleteIncident(tempSpace.id);

      // Return the full incident details
      return this.getIncidentById(newIncident.id);
    } catch (error) {
      // Clean up the temporary space if anything fails
      await this.deleteIncident(tempSpace.id).catch(() => {
        // Ignore errors during cleanup
      });
      throw error;
    }
  }
}
