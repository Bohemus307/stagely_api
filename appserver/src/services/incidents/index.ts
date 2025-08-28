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
import { NotFoundError } from "../../utils/errors";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Config } from "./comparison/comparisonTypes";
import { ClaudeClassificationService } from "../properties/spaces/classification/claudeClassifier";

// Define incident create/update input types with specific types
export interface CreateIncidentInput {
  propertyId: number;
  incidentType: string;
  description: string;
  reportedAt?: Date | string;
  severity: IncidentSeverity;
  status?: IncidentStatus;
  featureVector: Prisma.InputJsonObject;
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
  private spaceClassificationService: ClaudeClassificationService;
  private incidentClassificationService: ClaudeClassificationService;

  constructor(
    prisma: PrismaClient,
    s3: { client: S3Client; bucket: string; region: string },
  ) {
    this.incidentRepo = new IncidentRepository(prisma, s3);
    this.s3 = s3;
    this.spaceClassificationService = new ClaudeClassificationService(s3);

    // Initialize the new incident classification service
    const s3Config: S3Config = {
      client: s3.client,
      bucket: s3.bucket,
      region: s3.region,
    };
    this.incidentClassificationService = new ClaudeClassificationService(
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

    return incident;
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
            const imageURls = propertyImages.map((image) => image.imageUrl);
            // Reclassify based on all images (including new ones)
            const detectionResult =
              await this.incidentClassificationService.classifyMultipleImages(
                imageURls,
              );

            // Update incident with classification results
            await this.incidentRepo.updateIncident(id, {
              incidentType: incidentData.incidentType || incident.incidentType,
              severity: incidentData.severity || incident.severity,
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
  async getIncidentStats(
    propertyId?: number,
    propertyIds?: number[],
  ): Promise<IncidentStats> {
    return this.incidentRepo.getIncidentStats(propertyId, propertyIds);
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

        const imageURls = propertyImages.map((image) => image.imageUrl);
        // Reclassify based on all images (including new ones)
        const detectionResult =
          await this.incidentClassificationService.classifyMultipleImages(
            imageURls,
          );

        // Update incident with classification results
        await this.incidentRepo.updateIncident(id, {
          incidentType: incident.incidentType || incident.incidentType,
          severity: incident.severity || incident.severity,
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

        const imageURls = propertyImages.map((image) => image.imageUrl);
        // Reclassify based on all images (including new ones)
        const detectionResult =
          await this.incidentClassificationService.classifyMultipleImages(
            imageURls,
          );

        // Update incident with classification results
        await this.incidentRepo.updateIncident(incidentId, {
          incidentType: incident.incidentType || incident.incidentType,
          severity: incident.severity || incident.severity,
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
}
