import {
  PrismaClient,
  Inspection,
  PropertyImage,
  Prisma,
} from "@prisma/client";

// Define query parameters for inspection listing
export interface InspectionQueryParams {
  page?: number;
  limit?: number;
  propertyId?: number;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// Define inspection creation parameters
export interface CreateInspectionParams {
  propertyId: number;
  title?: string;
  description?: string | null;
  inspectionDate: Date;
}

// Define inspection update parameters
export interface UpdateInspectionParams {
  title?: string;
  description?: string | null;
  inspectionDate?: Date;
}

// Define image upload parameters
export interface UploadInspectionImageParams {
  inspectionId: number;
  imageUrl: string;
  caption?: string | null;
  takenAt: Date;
  spaceId?: number | null;
  metadata?: any | null;
}

// Define inspection response types with relations
export type InspectionWithImages = Inspection & {
  photos: (PropertyImage & {
    space?: {
      id: number;
      name: string | null;
      type: string;
    } | null;
  })[];
  property: {
    id: number;
    address: string;
    city: string;
  };
  _count: {
    photos: number;
  };
};

// Define full inspection details with property and space information
export type InspectionWithFullDetails = Inspection & {
  photos: (PropertyImage & {
    space?: {
      id: number;
      name: string | null;
      type: string;
    } | null;
  })[];
  property: {
    id: number;
    address: string;
    city: string;
    state: string | null;
    country: string;
    status: string;
  };
};

// Define paginated response type
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Repository for inspection-related database operations
 */
export class InspectionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get inspections with pagination and filtering
   */
  async getInspections(
    params: InspectionQueryParams,
  ): Promise<PaginatedResponse<InspectionWithImages>> {
    const {
      page = 1,
      limit = 10,
      propertyId,
      startDate,
      endDate,
      search,
      sortBy = "inspectionDate",
      sortOrder = "desc",
    } = params;

    // Build filter conditions
    const where: Prisma.InspectionWhereInput = {};

    if (propertyId) {
      where.propertyId = propertyId;
    }

    if (startDate && endDate) {
      where.inspectionDate = {
        gte: startDate,
        lte: endDate,
      };
    } else if (startDate) {
      where.inspectionDate = {
        gte: startDate,
      };
    } else if (endDate) {
      where.inspectionDate = {
        lte: endDate,
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Build sort order
    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    // Execute count query for pagination metadata
    const total = await this.prisma.inspection.count({ where });

    // Execute main query with relations
    const inspections = await this.prisma.inspection.findMany({
      where,
      include: {
        photos: {
          include: {
            space: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
        property: {
          select: {
            id: true,
            address: true,
            city: true,
          },
        },
        _count: {
          select: {
            photos: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    });

    return {
      data: inspections as InspectionWithImages[],
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a inspection by ID with all related information
   */
  async getInspectionById(
    id: number,
  ): Promise<InspectionWithFullDetails | null> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
      include: {
        photos: {
          include: {
            space: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
        property: {
          select: {
            id: true,
            address: true,
            city: true,
            state: true,
            country: true,
            status: true,
          },
        },
      },
    });

    return inspection as InspectionWithFullDetails | null;
  }

  /**
   * Create a new inspection
   */
  async createInspection(data: CreateInspectionParams): Promise<Inspection> {
    return this.prisma.inspection.create({
      data: {
        propertyId: data.propertyId,
        title: data.title || "Inspection",
        description: data.description,
        inspectionDate: data.inspectionDate,
      },
    });
  }

  /**
   * Update an inspection
   */
  async updateInspection(
    id: number,
    data: UpdateInspectionParams,
  ): Promise<Inspection> {
    return this.prisma.inspection.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete an inspection
   */
  async deleteInspection(id: number): Promise<Inspection> {
    return this.prisma.inspection.delete({
      where: { id },
    });
  }

  /**
   * Upload an image to an inspection
   */
  async uploadInspectionImage(
    data: UploadInspectionImageParams,
  ): Promise<PropertyImage> {
    return this.prisma.propertyImage.create({
      data: {
        inspectionId: data.inspectionId,
        imageUrl: data.imageUrl,
        caption: data.caption,
        takenAt: data.takenAt,
        spaceId: data.spaceId,
        metadata: data.metadata || undefined,
      },
    });
  }

  /**
   * Update an inspection image
   */
  async updateInspectionImage(
    id: number,
    data: {
      caption?: string | null;
      spaceId?: number | null;
      metadata?: any | null;
    },
  ): Promise<PropertyImage> {
    return this.prisma.propertyImage.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete an inspection image
   */
  async deleteInspectionImage(id: number): Promise<PropertyImage> {
    return this.prisma.propertyImage.delete({
      where: { id },
    });
  }

  /**
   * Get inspection images by inspection ID
   */
  async getInspectionImages(inspectionId: number): Promise<PropertyImage[]> {
    return this.prisma.propertyImage.findMany({
      where: { inspectionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });
  }

  /**
   * Classify multiple images to a space
   */
  async classifyImagesToSpace(
    imageIds: number[],
    spaceId: number,
  ): Promise<number> {
    const result = await this.prisma.propertyImage.updateMany({
      where: {
        id: { in: imageIds },
      },
      data: {
        spaceId,
      },
    });

    return result.count;
  }

  /**
   * Get inspection statistics for a property
   */
  async getPropertyInspectionStats(propertyId: number): Promise<{
    totalInspections: number;
    totalImages: number;
    lastInspectionDate: Date | null;
    imagesByType: Record<string, number>;
  }> {
    // Get total inspections count
    const totalInspections = await this.prisma.inspection.count({
      where: { propertyId },
    });

    // Get total images count
    const totalImages = await this.prisma.propertyImage.count({
      where: {
        inspection: {
          propertyId,
        },
      },
    });

    // Get latest inspection date
    const latestInspection = await this.prisma.inspection.findFirst({
      where: { propertyId },
      orderBy: { inspectionDate: "desc" },
      select: { inspectionDate: true },
    });

    // Get images by space type
    const imagesBySpace = await this.prisma.propertySpace.findMany({
      where: { propertyId },
      select: {
        type: true,
        _count: {
          select: {
            images: true,
          },
        },
      },
    });

    const imagesByType: Record<string, number> = {};
    imagesBySpace.forEach((space) => {
      const type = space.type.toString();
      imagesByType[type] = (imagesByType[type] || 0) + space._count.images;
    });

    return {
      totalInspections,
      totalImages,
      lastInspectionDate: latestInspection?.inspectionDate || null,
      imagesByType,
    };
  }
}
