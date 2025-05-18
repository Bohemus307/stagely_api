import { S3Client } from "@aws-sdk/client-s3";
import {
  PrismaClient,
  Incident,
  IncidentStatus,
  IncidentSeverity,
  Property,
  PropertyImage,
  Prisma,
} from "@prisma/client";

// Define types for query parameters
export interface IncidentQueryParams {
  page?: number;
  limit?: number;
  propertyId?: number;
  propertyIds?: number[];
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  incidentType?: string;
  fromDate?: string | Date;
  toDate?: string | Date;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface UploadIncidentImageParams {
  incidentId?: number;
  imageUrl: string;
  caption?: string | null;
  takenAt: Date;
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

// Define incident with included relations type
export interface IncidentWithRelations extends Incident {
  property: Pick<Property, "id" | "address" | "city" | "state" | "country">;
  images: Pick<PropertyImage, "id" | "imageUrl" | "caption" | "createdAt">[];
}

// Define incident with full relations type
export interface IncidentWithFullRelations extends Incident {
  property: Property;
  images: PropertyImage[];
}

// Define incident statistics type
export interface IncidentStats {
  byStatus: {
    status: IncidentStatus;
    _count: number;
  }[];
  bySeverity: {
    severity: IncidentSeverity;
    _count: number;
  }[];
  topIncidentTypes: {
    incidentType: string;
    _count: number;
  }[];
  avgResolutionTime: number;
}

/**
 * Repository for handling Incident-related database operations
 */
export class IncidentRepository {
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
   * Get incidents with pagination, filtering and sorting
   */
  async getIncidents({
    page = 1,
    limit = 10,
    propertyId,
    propertyIds,
    status,
    severity,
    incidentType,
    fromDate,
    toDate,
    sortBy = "reportedAt",
    sortOrder = "desc",
  }: IncidentQueryParams): Promise<PaginatedResponse<IncidentWithRelations>> {
    const skip = (page - 1) * limit;

    // Build where conditions
    const where: any = {};
    if (propertyId) {
      where.propertyId = propertyId;
    } else if (propertyIds && propertyIds.length > 0) {
      where.propertyId = { in: propertyIds };
    }
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (incidentType) where.incidentType = incidentType;

    // Date range filtering
    if (fromDate || toDate) {
      where.reportedAt = {};
      if (fromDate) where.reportedAt.gte = new Date(fromDate);
      if (toDate) where.reportedAt.lte = new Date(toDate);
    }

    // Build sorting
    const orderBy: any = {};
    orderBy[sortBy] = sortOrder.toLowerCase();

    // Run query with transaction for consistent results
    const [incidents, total] = await this.prisma.$transaction([
      this.prisma.incident.findMany({
        skip,
        take: limit,
        where,
        orderBy,
        include: {
          property: {
            select: {
              id: true,
              address: true,
              city: true,
              state: true,
              country: true,
            },
          },
          images: {
            take: 2,
            orderBy: {
              createdAt: "desc",
            },
            select: {
              id: true,
              imageUrl: true,
              caption: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.incident.count({ where }),
    ]);

    return {
      data: incidents,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get incident by ID with all related data
   */
  async getIncidentById(id: number): Promise<IncidentWithFullRelations> {
    return this.prisma.incident.findUniqueOrThrow({
      where: { id },
      include: {
        property: true,
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
      skipDuplicates: true, // Skip if the same object is already labeled
    });
  }

  /**
   * Create a new incident
   */
  async createIncident(
    data: Omit<
      Prisma.IncidentUncheckedCreateInput,
      "id" | "createdAt" | "updatedAt"
    >,
  ): Promise<Incident> {
    // Use transaction to ensure both incident is created and property is updated
    return this.prisma.$transaction(async (tx) => {
      // Create incident
      const incident = await tx.incident.create({
        data: {
          ...data,
          reportedAt: data.reportedAt || new Date(),
        },
      });

      // Update property statistics
      await tx.property.update({
        where: { id: data.propertyId },
        data: {
          incidentCount: { increment: 1 },
          openIncidentCount: { increment: 1 },
          lastIncidentAt: new Date(),
        },
      });

      return incident;
    });
  }

  /**
   * Update an incident with partial data
   */
  async updateIncident(
    id: number,
    data: Prisma.IncidentUpdateInput,
  ): Promise<Incident> {
    return this.prisma.incident.update({
      where: { id },
      data,
    });
  }

  /**
   * Get all images for a specific incident
   */
  async getIncidentImages(incidentId: number): Promise<PropertyImage[]> {
    return this.prisma.propertyImage.findMany({
      where: { incidentId },
      orderBy: { takenAt: "desc" },
    });
  }

  /**
   * Update incident status
   */
  async updateIncidentStatus(
    id: number,
    status: IncidentStatus,
    resolvedAt: Date | null = null,
  ): Promise<Incident> {
    return this.prisma.$transaction(async (tx) => {
      // Get current incident
      const currentIncident = await tx.incident.findUniqueOrThrow({
        where: { id },
        select: { status: true, propertyId: true },
      });

      // Calculate property counter changes
      let openIncidentChange = 0;

      // Based on the schema, In_Progress is mapped to "In Progress"
      if (
        currentIncident.status === IncidentStatus.Open ||
        currentIncident.status === IncidentStatus.In_Progress
      ) {
        if (
          status === IncidentStatus.Resolved ||
          status === IncidentStatus.Closed
        ) {
          openIncidentChange = -1;
        }
      } else if (
        status === IncidentStatus.Open ||
        status === IncidentStatus.In_Progress
      ) {
        openIncidentChange = 1;
      }

      // Update incident
      const incident = await tx.incident.update({
        where: { id },
        data: {
          status,
          resolvedAt:
            status === IncidentStatus.Resolved ||
            status === IncidentStatus.Closed
              ? resolvedAt || new Date()
              : null,
        },
      });

      // Update property if needed
      if (openIncidentChange !== 0) {
        await tx.property.update({
          where: { id: currentIncident.propertyId },
          data: {
            openIncidentCount: {
              increment: openIncidentChange,
            },
          },
        });
      }

      return incident;
    });
  }

  /**
   * Delete an incident
   */
  async deleteIncident(id: number): Promise<{ success: boolean; id: number }> {
    return this.prisma.$transaction(async (tx) => {
      // Get current incident
      const incident = await tx.incident.findUniqueOrThrow({
        where: { id },
        select: { status: true, propertyId: true },
      });

      // Calculate property counter changes
      const decrementOpen =
        incident.status === IncidentStatus.Open ||
        incident.status === IncidentStatus.In_Progress
          ? 1
          : 0;

      // Delete incident
      await tx.incident.delete({
        where: { id },
      });

      // Update property
      await tx.property.update({
        where: { id: incident.propertyId },
        data: {
          incidentCount: { decrement: 1 },
          openIncidentCount: { decrement: decrementOpen },
        },
      });

      return { success: true, id };
    });
  }

  /**
   * Add images to an incident
   */
  async addIncidentImages(
    incidentId: number,
    images: { imageUrl: string; caption?: string; takenAt?: Date }[],
  ): Promise<PropertyImage[]> {
    await this.prisma.propertyImage.createMany({
      data: images.map((img) => ({
        incidentId,
        imageUrl: img.imageUrl,
        caption: img.caption,
        takenAt: img.takenAt || new Date(),
      })),
    });

    return this.prisma.propertyImage.findMany({
      where: { incidentId },
    });
  }

  /**
   * Upload an image to an property space
   */
  async uploadIncidentImage(
    data: UploadIncidentImageParams,
  ): Promise<PropertyImage> {
    return this.prisma.propertyImage.create({
      data: {
        imageUrl: data.imageUrl,
        caption: data.caption,
        takenAt: data.takenAt,
        incidentId: data.incidentId as number,
        metadata: data.metadata || undefined,
      },
    });
  }

  /**
   * Associate images with a incident
   */
  async associateImagesWithIncident(
    incidentId: number,
    imageIds: number[],
  ): Promise<void> {
    await this.prisma.$transaction(
      imageIds.map((imageId) =>
        this.prisma.propertyImage.update({
          where: { id: imageId },
          data: { incidentId },
        }),
      ),
    );
  }

  /**
   * Get incident statistics
   */
  async getIncidentStats(
    propertyId?: number,
    propertyIds?: number[],
  ): Promise<IncidentStats> {
    let where: any = {};

    if (propertyId) {
      where.propertyId = propertyId;
    } else if (propertyIds && propertyIds.length > 0) {
      where.propertyId = { in: propertyIds };
    }

    // Get all possible status values directly from the enum
    const statuses = Object.values(IncidentStatus);

    // Get all possible severity values directly from the enum
    const severities = Object.values(IncidentSeverity);

    // Using transactions to get all the data we need
    return this.prisma.$transaction(async (tx) => {
      // Get status counts
      const statusCounts = await Promise.all(
        statuses.map((status) =>
          tx.incident.count({
            where: {
              ...where,
              status,
            },
          }),
        ),
      );

      // Get severity counts
      const severityCounts = await Promise.all(
        severities.map((severity) =>
          tx.incident.count({
            where: {
              ...where,
              severity,
            },
          }),
        ),
      );

      // Get incident types and their counts
      const incidentTypes = await tx.incident.findMany({
        where,
        select: { incidentType: true },
        distinct: ["incidentType"],
      });

      const typeCounts = await Promise.all(
        incidentTypes.map((type) =>
          tx.incident.count({
            where: {
              ...where,
              incidentType: type.incidentType,
            },
          }),
        ),
      );

      // Get types with counts and sort by count
      const typeCountsWithNames = incidentTypes
        .map((type, i) => ({
          incidentType: type.incidentType,
          count: typeCounts[i],
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Get average resolution time
      const resolvedIncidents = await tx.incident.findMany({
        where: {
          ...where,
          resolvedAt: { not: null },
          reportedAt: { not: null },
        },
        select: {
          reportedAt: true,
          resolvedAt: true,
        },
      });

      let avgResolutionTimeHours = 0;
      if (resolvedIncidents.length > 0) {
        const totalHours = resolvedIncidents.reduce((sum, incident) => {
          const reportedAt = incident.reportedAt.getTime();
          const resolvedAt = incident.resolvedAt!.getTime();
          const diffHours = (resolvedAt - reportedAt) / (1000 * 60 * 60);
          return sum + diffHours;
        }, 0);
        avgResolutionTimeHours = totalHours / resolvedIncidents.length;
      }

      return {
        byStatus: statuses.map((status, i) => ({
          status,
          _count: statusCounts[i],
        })),
        bySeverity: severities.map((severity, i) => ({
          severity,
          _count: severityCounts[i],
        })),
        topIncidentTypes: typeCountsWithNames.map((item) => ({
          incidentType: item.incidentType,
          _count: item.count,
        })),
        avgResolutionTime: avgResolutionTimeHours,
      };
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
}
