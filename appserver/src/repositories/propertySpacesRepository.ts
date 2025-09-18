import {
  PrismaClient,
  PropertySpace,
  SpaceType,
  PropertyImage,
  Prisma,
  SpaceObjectLabel,
} from "@prisma/client";
import { S3Client } from "@aws-sdk/client-s3";
import { ClaudeClassificationService } from "../services/properties/spaces/classification/claudeClassifier";
import { DynamoDBEventRepository } from "./dynamoDB/eventsRepository";

export const PropertySpaceEventTypes = {
  SPACE_CREATED: "property.space.created",
  SPACE_UPDATED: "property.space.updated",
  SPACE_DELETED: "property.space.deleted",
  SPACE_CLASSIFIED: "property.space.classified",
  SPACE_IMAGE_ADDED: "property.space.image_added",
  SPACE_IMAGE_REMOVED: "property.space.image_removed",
  SPACE_LABEL_ADDED: "property.space.label_added",
  SPACE_LABEL_UPDATED: "property.space.labels_updated",
} as const;

// Define types for query parameters
export interface PropertySpaceQueryParams {
  page?: number;
  limit?: number;
  propertyId?: number;
  spaceType?: SpaceType;
  aiGenerated?: boolean;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface UploadPropertySpaceImageParams {
  inspectionId?: number;
  imageUrl: string;
  caption?: string | null;
  takenAt: Date;
  spaceId?: number | null;
  metadata?: any | null;
}

// Define response types
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Define property space with included relations type
export interface PropertySpaceWithRelations extends PropertySpace {
  images: PropertyImage[];
}

// Define property space with full relations type
export interface PropertySpaceWithFullRelations extends PropertySpace {
  images: PropertyImage[];
  property: {
    id: number;
    address: string;
    city: string;
    state: string | null;
    zipCode: string | null;
    country: string;
    status: string;
  };
}

// Define space classification result type
export interface SpaceClassificationResult {
  spaceId?: number;
  incidentId?: number;
  spaceType: SpaceType;
  confidenceScore: Prisma.Decimal;
  featureVector: Prisma.JsonValue;
  objectLabels?: string[]; // Optional field with "?"
}

/**
 * Repository for handling PropertySpace-related database operations
 */
export class PropertySpaceRepository {
  private prisma: PrismaClient;
  private s3: { client: S3Client; bucket: string; region: string };

  private eventRepo: DynamoDBEventRepository;

  constructor(
    prisma: PrismaClient,
    s3: { client: S3Client; bucket: string; region: string },
    eventRepo: DynamoDBEventRepository,
  ) {
    this.prisma = prisma;
    this.s3 = s3;
    this.eventRepo = eventRepo;
  }

  /**
   * Helper method to log events safely
   */
  private async logEvent(
    eventType: string,
    userId?: number,
    entityId?: string,
    entityType: string = "property_space",
    metadata?: Record<string, any>,
  ): Promise<void> {
    if (!this.eventRepo) return;

    try {
      await this.eventRepo.saveEvent(
        eventType,
        userId,
        entityId,
        entityType,
        metadata,
        "property-space-service",
      );
    } catch (error) {
      console.error("Failed to log event:", error);
    }
  }

  /**
   * Get property spaces with pagination, filtering and sorting
   */
  async getPropertySpaces({
    page = 1,
    limit = 10,
    propertyId,
    spaceType,
    aiGenerated,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
  }: PropertySpaceQueryParams): Promise<
    PaginatedResponse<PropertySpaceWithRelations>
  > {
    const skip = (page - 1) * limit;

    // Build where conditions
    const where: Prisma.PropertySpaceWhereInput = {};

    if (propertyId) {
      where.propertyId = propertyId;
    }

    if (spaceType) {
      where.type = spaceType;
    }

    if (aiGenerated !== undefined) {
      where.aiGenerated = aiGenerated;
    }

    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    // Build sorting
    const orderBy: Prisma.PropertySpaceOrderByWithRelationInput = {};
    orderBy[sortBy as keyof Prisma.PropertySpaceOrderByWithRelationInput] =
      sortOrder;

    // Execute query with count
    const [spaces, total] = await Promise.all([
      this.prisma.propertySpace.findMany({
        skip,
        take: limit,
        where,
        orderBy,
        include: {
          images: true,
        },
      }),
      this.prisma.propertySpace.count({ where }),
    ]);

    return {
      data: spaces,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get images by their IDs
   */
  async getImagesByIds(imageIds: number[]): Promise<PropertyImage[]> {
    return this.prisma.propertyImage.findMany({
      where: {
        id: {
          in: imageIds,
        },
      },
    });
  }

  /**
   * Get a property space by ID with all related data
   */
  async getSpaceById(id: number): Promise<PropertySpaceWithFullRelations> {
    const space = await this.prisma.propertySpace.findUniqueOrThrow({
      where: { id },
      include: {
        images: true,
        objectLabels: true,
        property: {
          select: {
            id: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            status: true,
          },
        },
      },
    });

    return space;
  }

  /**
   * Get the most recent image for a property space
   */
  async getMostRecentSpaceImage(
    spaceId: number,
  ): Promise<PropertyImage | null> {
    return this.prisma.propertyImage.findFirst({
      where: { spaceId },
      orderBy: { takenAt: "desc" },
    });
  }

  /**
   * Get all spaces for a property
   */
  async getSpacesByPropertyId(
    propertyId: number,
    params: Omit<PropertySpaceQueryParams, "propertyId"> = {},
  ): Promise<PropertySpaceWithRelations[]> {
    const {
      spaceType,
      aiGenerated,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = params;

    // Build where conditions
    const where: Prisma.PropertySpaceWhereInput = {
      propertyId,
    };

    if (spaceType) {
      where.type = spaceType;
    }

    if (aiGenerated !== undefined) {
      where.aiGenerated = aiGenerated;
    }

    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    // Build sorting
    const orderBy: Prisma.PropertySpaceOrderByWithRelationInput = {};
    orderBy[sortBy as keyof Prisma.PropertySpaceOrderByWithRelationInput] =
      sortOrder;

    return this.prisma.propertySpace.findMany({
      where,
      include: {
        objectLabels: true,
        images: true,
      },
      orderBy,
    });
  }

  /**
   * Create a new property space
   */
  async createSpace(
    data: Prisma.PropertySpaceUncheckedCreateInput,
  ): Promise<PropertySpace> {
    const space = await this.prisma.propertySpace.create({
      data,
    });

    // Get the property owner's userId for the event
    const property = await this.prisma.property.findUnique({
      where: { id: space.propertyId },
      select: { userId: true },
    });

    // Log space creation event
    await this.logEvent(
      PropertySpaceEventTypes.SPACE_CREATED,
      property?.userId,
      space.id.toString(),
      "property_space",
      {
        propertyId: space.propertyId,
        spaceType: space.type,
        aiGenerated: space.aiGenerated,
        name: space.name,
      },
    );

    return space;
  }

  /**
   * Update a property space
   */
  async updateSpace(
    id: number,
    data: Prisma.PropertySpaceUpdateInput,
  ): Promise<PropertySpace> {
    // Get current space info for comparison
    const currentSpace = await this.prisma.propertySpace.findUnique({
      where: { id },
      include: {
        property: {
          select: { userId: true },
        },
      },
    });

    if (!currentSpace) {
      throw new Error(`Property space ${id} not found`);
    }

    const updatedSpace = await this.prisma.propertySpace.update({
      where: { id },
      data,
    });

    // Log the update event with the changed fields
    const changedFields = Object.keys(data).filter(
      (key) => data[key as keyof typeof data] !== undefined,
    );

    await this.logEvent(
      PropertySpaceEventTypes.SPACE_UPDATED,
      currentSpace.property.userId,
      id.toString(),
      "property_space",
      {
        propertyId: updatedSpace.propertyId,
        spaceType: updatedSpace.type,
        updatedFields: changedFields,
      },
    );

    return updatedSpace;
  }

  /**
   * Delete a property space
   */
  async deleteSpace(id: number): Promise<PropertySpace> {
    // Get space details before deletion
    const spaceToDelete = await this.prisma.propertySpace.findUnique({
      where: { id },
      include: {
        property: {
          select: { userId: true },
        },
        images: {
          select: { id: true },
        },
        objectLabels: {
          select: { id: true },
        },
      },
    });

    if (!spaceToDelete) {
      throw new Error(`Property space ${id} not found`);
    }

    const deletedSpace = await this.prisma.propertySpace.delete({
      where: { id },
    });

    // Log deletion with context about what was deleted
    await this.logEvent(
      PropertySpaceEventTypes.SPACE_DELETED,
      spaceToDelete.property.userId,
      id.toString(),
      "property_space",
      {
        propertyId: spaceToDelete.propertyId,
        spaceType: spaceToDelete.type,
        name: spaceToDelete.name,
        stats: {
          imageCount: spaceToDelete.images.length,
          labelCount: spaceToDelete.objectLabels.length,
        },
      },
    );

    return deletedSpace;
  }

  /**
   * Associate images with a space
   */
  async associateImagesWithSpace(
    spaceId: number,
    imageIds: number[],
  ): Promise<void> {
    // Get the space and its property's userId
    const space = await this.prisma.propertySpace.findUnique({
      where: { id: spaceId },
      include: {
        property: {
          select: { userId: true },
        },
      },
    });

    if (!space) {
      throw new Error(`Property space ${spaceId} not found`);
    }

    await this.prisma.$transaction(
      imageIds.map((imageId) =>
        this.prisma.propertyImage.update({
          where: { id: imageId },
          data: { spaceId },
        }),
      ),
    );

    // Log the image association event
    await this.logEvent(
      PropertySpaceEventTypes.SPACE_IMAGE_ADDED,
      space.property.userId,
      spaceId.toString(),
      "property_space",
      {
        propertyId: space.propertyId,
        spaceType: space.type,
        imageCount: imageIds.length,
        imageIds: imageIds,
      },
    );
  }

  /**
   * Remove image associations from a space
   */
  async removeImagesFromSpace(
    spaceId: number,
    imageIds: number[],
  ): Promise<void> {
    // Get the space and its property's userId
    const space = await this.prisma.propertySpace.findUnique({
      where: { id: spaceId },
      include: {
        property: {
          select: { userId: true },
        },
      },
    });

    if (!space) {
      throw new Error(`Property space ${spaceId} not found`);
    }

    await this.prisma.propertyImage.updateMany({
      where: {
        id: {
          in: imageIds,
        },
        spaceId,
      },
      data: {
        spaceId: null,
      },
    });

    // Log the image removal event
    await this.logEvent(
      PropertySpaceEventTypes.SPACE_IMAGE_REMOVED,
      space.property.userId,
      spaceId.toString(),
      "property_space",
      {
        propertyId: space.propertyId,
        spaceType: space.type,
        imageCount: imageIds.length,
        imageIds: imageIds,
      },
    );
  }

  /**
   * Upload an image to an property space
   */
  async uploadPropertySpaceImage(
    data: UploadPropertySpaceImageParams,
  ): Promise<PropertyImage> {
    const image = await this.prisma.propertyImage.create({
      data: {
        imageUrl: data.imageUrl,
        caption: data.caption,
        takenAt: data.takenAt,
        spaceId: data.spaceId,
        metadata: data.metadata || undefined,
      },
    });

    // Only log if the image is associated with a space
    if (data.spaceId) {
      // Get the space and its property's userId
      const space = await this.prisma.propertySpace.findUnique({
        where: { id: data.spaceId },
        include: {
          property: {
            select: { userId: true },
          },
        },
      });

      if (space) {
        // Log the image upload event
        await this.logEvent(
          PropertySpaceEventTypes.SPACE_IMAGE_ADDED,
          space.property.userId,
          data.spaceId.toString(),
          "property_space",
          {
            propertyId: space.propertyId,
            spaceType: space.type,
            imageId: image.id,
            imageUrl: image.imageUrl,
          },
        );
      }
    }

    return image;
  }

  /**
   * Get all images associated with a space
   */
  async getSpaceImages(spaceId: number): Promise<PropertyImage[]> {
    return this.prisma.propertyImage.findMany({
      where: { spaceId },
    });
  }

  /**
   * Classify a space based on its images using the SpaceClassificationService
   */
  async classifySpaceFromImages(
    spaceId: number,
    images: PropertyImage[],
  ): Promise<SpaceClassificationResult> {
    try {
      // Extract image URLs from the PropertyImage objects
      const imageUrls = images.map((img) => img.imageUrl);

      if (imageUrls.length === 0) {
        throw new Error("No images provided for classification");
      }

      // Create an instance of SpaceClassificationService
      const classificationService = new ClaudeClassificationService(this.s3);

      // Use the service to classify multiple images
      const result =
        await classificationService.classifyMultipleImages(imageUrls);

      const space = await this.prisma.propertySpace.findUnique({
        where: { id: spaceId },
        include: {
          property: {
            select: { userId: true, id: true },
          },
        },
      });

      // Log the classification event
      if (space) {
        await this.logEvent(
          PropertySpaceEventTypes.SPACE_CLASSIFIED,
          space.property.userId,
          spaceId.toString(),
          "property_space",
          {
            propertyId: space.property.id,
            previousType: space.type,
            newType: result.spaceType,
            confidenceScore: result.confidenceScore,
            imageCount: images.length,
          },
        );
      }

      // Convert the result to our expected format
      return {
        spaceId,
        spaceType: result.spaceType,
        confidenceScore: new Prisma.Decimal(result.confidenceScore.toString()),
        featureVector: result.featureVector,
      };
    } catch (error) {
      console.error(`Error classifying space ${spaceId}:`, error);

      // Fallback to a default classification if the service fails
      //const spaceTypes = Object.values(SpaceType);
      const fallbackType = SpaceType.Unknown;

      return {
        spaceId,
        spaceType: fallbackType,
        confidenceScore: new Prisma.Decimal("0.1"),
        featureVector: {
          dimensions: Object.values(SpaceType).map((type) =>
            type === fallbackType ? 0.1 : 0,
          ),
          dominantColors: ["unknown"],
          detectedObjects: ["unknown"],
        },
      };
    }
  }

  /**
   * Get spaces by type for a property
   */
  async getSpacesByType(
    propertyId: number,
    type: SpaceType,
  ): Promise<PropertySpace[]> {
    return this.prisma.propertySpace.findMany({
      where: {
        propertyId,
        type,
      },
      include: {
        images: true,
      },
    });
  }

  /**
   * Associate object labels with an existing space
   */
  async addObjectLabelsToSpace(
    spaceId: number,
    objectLabels: Array<{
      name: string;
      confidence: number;
      category?: string;
    }>,
  ): Promise<void> {
    if (!objectLabels || objectLabels.length === 0) return;

    await this.prisma.spaceObjectLabel.createMany({
      data: objectLabels.map((label) => ({
        spaceId,
        name: label.name,
        confidence: new Prisma.Decimal(label.confidence.toFixed(4)),
        category: label.category,
      })),
      skipDuplicates: true,
    });

    // Get the space and its property's userId
    const space = await this.prisma.propertySpace.findUnique({
      where: { id: spaceId },
      include: {
        property: {
          select: { userId: true },
        },
      },
    });

    if (!space) return;

    // Log label addition event
    await this.logEvent(
      PropertySpaceEventTypes.SPACE_LABEL_ADDED,
      space.property.userId,
      spaceId.toString(),
      "property_space",
      {
        propertyId: space.propertyId,
        spaceType: space.type,
        labelCount: objectLabels.length,
        topLabels: objectLabels
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 5)
          .map((l) => l.name),
      },
    );
  }

  /**
   * Update object labels for a space (replaces existing labels)
   */
  async updateSpaceObjectLabels(
    spaceId: number,
    objectLabels: Array<{
      name: string;
      confidence: number;
      category?: string;
    }>,
  ): Promise<void> {
    // Get the space and its property's userId before updating
    const space = await this.prisma.propertySpace.findUnique({
      where: { id: spaceId },
      include: {
        property: {
          select: { userId: true },
        },
        objectLabels: true,
      },
    });

    if (!space) return;

    const previousLabelCount = space.objectLabels.length;

    // Your existing transaction code...

    // After updating the labels, add this:
    // Log label update event
    await this.logEvent(
      PropertySpaceEventTypes.SPACE_LABEL_UPDATED,
      space.property.userId,
      spaceId.toString(),
      "property_space",
      {
        propertyId: space.propertyId,
        spaceType: space.type,
        previousLabelCount,
        newLabelCount: objectLabels.length,
        topLabels: objectLabels
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 5)
          .map((l) => l.name),
      },
    );
  }
}
