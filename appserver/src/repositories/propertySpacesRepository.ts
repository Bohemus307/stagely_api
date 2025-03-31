import {
  PrismaClient,
  PropertySpace,
  SpaceType,
  PropertyImage,
  Prisma,
  SpaceObjectLabel,
} from "@prisma/client";
import { SpaceClassificationService } from "../services/properties/spaces/classification";
import { S3Client } from "@aws-sdk/client-s3";

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

  constructor(
    prisma: PrismaClient,
    s3: { client: S3Client; bucket: string; region: string },
  ) {
    this.prisma = prisma;
    this.s3 = s3;
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
    return this.prisma.propertySpace.create({
      data,
    });
  }

  /**
   * Update a property space
   */
  async updateSpace(
    id: number,
    data: Prisma.PropertySpaceUpdateInput,
  ): Promise<PropertySpace> {
    return this.prisma.propertySpace.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a property space
   */
  async deleteSpace(id: number): Promise<PropertySpace> {
    return this.prisma.propertySpace.delete({
      where: { id },
    });
  }

  /**
   * Check if a property exists
   */
  async propertyExists(propertyId: number): Promise<boolean> {
    const count = await this.prisma.property.count({
      where: { id: propertyId },
    });
    return count > 0;
  }

  /**
   * Validate that all provided image IDs exist
   */
  async validatePropertyImages(imageIds: number[]): Promise<number[]> {
    if (imageIds.length === 0) return [];

    const images = await this.prisma.propertyImage.findMany({
      where: {
        id: {
          in: imageIds,
        },
      },
      select: {
        id: true,
      },
    });

    return images.map((img) => img.id);
  }

  /**
   * Associate images with a space
   */
  async associateImagesWithSpace(
    spaceId: number,
    imageIds: number[],
  ): Promise<void> {
    await this.prisma.$transaction(
      imageIds.map((imageId) =>
        this.prisma.propertyImage.update({
          where: { id: imageId },
          data: { spaceId },
        }),
      ),
    );
  }

  /**
   * Remove image associations from a space
   */
  async removeImagesFromSpace(
    spaceId: number,
    imageIds: number[],
  ): Promise<void> {
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
  }

  /**
   * Upload an image to an property space
   */
  async uploadPropertySpaceImage(
    data: UploadPropertySpaceImageParams,
  ): Promise<PropertyImage> {
    return this.prisma.propertyImage.create({
      data: {
        imageUrl: data.imageUrl,
        caption: data.caption,
        takenAt: data.takenAt,
        spaceId: data.spaceId as number,
        metadata: data.metadata || undefined,
      },
    });
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
      const classificationService = new SpaceClassificationService(this.s3);

      // Use the service to classify multiple images
      const result =
        await classificationService.classifyMultipleImages(imageUrls);

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
   * Get similar spaces based on feature vectors
   */
  async getSimilarSpaces(
    spaceId: number,
    featureVector: Prisma.JsonValue,
    limit: number = 5,
  ): Promise<PropertySpace[]> {
    // In a real implementation, this would use vector similarity search
    // For demonstration, we'll just get other spaces of the same type

    const currentSpace = await this.prisma.propertySpace.findUnique({
      where: { id: spaceId },
    });

    if (!currentSpace) {
      throw new Error(`Property space with ID ${spaceId} not found`);
    }

    return this.prisma.propertySpace.findMany({
      where: {
        id: { not: spaceId },
        type: currentSpace.type,
        //featureVector: { not: null },
      },
      take: limit,
    });
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
   * Create a space with object labels
   */
  async createSpaceWithObjectLabels(
    spaceData: {
      propertyId: number;
      name: string;
      type: SpaceType;
      confidenceScore: Prisma.Decimal;
      featureVector: Prisma.InputJsonValue;
      aiGenerated: boolean;
    },
    objectLabels: Array<{
      name: string;
      confidence: number;
      category?: string;
    }>,
  ): Promise<PropertySpace> {
    // Create the space with labels in a transaction
    return await this.prisma.$transaction(async (tx) => {
      // First create the space
      const space = await tx.propertySpace.create({
        data: spaceData,
      });

      // Then create the object labels if we have any
      if (objectLabels && objectLabels.length > 0) {
        await tx.spaceObjectLabel.createMany({
          data: objectLabels.map((label) => ({
            spaceId: space.id,
            name: label.name,
            confidence: new Prisma.Decimal(label.confidence.toFixed(4)),
            category: label.category,
          })),
        });
      }

      return space;
    });
  }

  /**
   * Get object labels for a space
   */
  async getSpaceObjectLabels(spaceId: number): Promise<SpaceObjectLabel[]> {
    return await this.prisma.spaceObjectLabel.findMany({
      where: { spaceId },
      orderBy: { confidence: "desc" },
    });
  }

  /**
   * Find spaces by object label
   */
  async findSpacesByObjectLabel(
    propertyId: number,
    labelName: string,
  ): Promise<PropertySpace[]> {
    return await this.prisma.propertySpace.findMany({
      where: {
        propertyId,
        objectLabels: {
          some: {
            name: {
              contains: labelName,
              mode: "insensitive", // Case-insensitive search
            },
          },
        },
      },
      include: {
        objectLabels: true,
      },
    });
  }

  /**
   * Search for spaces by object label category
   */
  async findSpacesByLabelCategory(
    propertyId: number,
    category: string,
  ): Promise<PropertySpace[]> {
    return await this.prisma.propertySpace.findMany({
      where: {
        propertyId,
        objectLabels: {
          some: {
            category: {
              equals: category,
              mode: "insensitive",
            },
          },
        },
      },
      include: {
        objectLabels: true,
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
      skipDuplicates: true, // Skip if the same object is already labeled
    });
  }
}
