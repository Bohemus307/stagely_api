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
import { DynamoDBEventRepository } from "./dynamoDB/eventsRepository";

// Event types for incidents
export const IncidentEventTypes = {
  // Incident lifecycle events
  INCIDENT_CREATED: "incident.created",
  INCIDENT_UPDATED: "incident.updated",
  INCIDENT_DELETED: "incident.deleted",

  // Status changes (critical for tracking)
  INCIDENT_STATUS_CHANGED: "incident.status_changed",
  INCIDENT_RESOLVED: "incident.resolved",
  INCIDENT_REOPENED: "incident.reopened",

  // Severity changes (important for escalation tracking)
  INCIDENT_SEVERITY_CHANGED: "incident.severity_changed",
  INCIDENT_ESCALATED: "incident.escalated", // When severity increases

  // Image events
  INCIDENT_IMAGES_ADDED: "incident.images_added",
} as const;

export interface IncidentQueryParams {
  search?: string;
  page?: number;
  limit?: number;
  propertyId?: number;
  propertyIds?: number[];
  status?: string;
  severity?: string;
  incidentType?: string;
  fromDate?: string;
  toDate?: string;
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
  property: Pick<
    Property,
    "id" | "address" | "city" | "state" | "country" | "latitude" | "longitude"
  >;
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
 * Repository for handling Incident-related database operations with event logging
 */
export class IncidentRepository {
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
    entityType: string = "incident",
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
        "incident-service",
      );
    } catch (error) {
      console.error("Failed to log event:", error);
    }
  }

  /**
   * Get incidents with pagination, filtering, sorting and search
   * No event logging - searching/viewing is not a meaningful event
   */
  async getIncidents({
    search,
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

    // Property filtering
    if (propertyId) {
      where.propertyId = propertyId;
    } else if (propertyIds && propertyIds.length > 0) {
      where.propertyId = { in: propertyIds };
    }

    // Status and severity filters
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (incidentType && !search) where.incidentType = incidentType;

    // Date range filtering
    if (fromDate || toDate) {
      where.reportedAt = {};
      if (fromDate) where.reportedAt.gte = new Date(fromDate);
      if (toDate) where.reportedAt.lte = new Date(toDate);
    }

    // Add search conditions
    if (search) {
      where.OR = [
        { description: { contains: search, mode: "insensitive" } },
        { incidentType: { contains: search, mode: "insensitive" } },
        {
          property: {
            OR: [
              { address: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
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
              zipCode: true,
              country: true,
              latitude: true,
              longitude: true,
              status: true,
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
              takenAt: true,
              createdAt: true,
            },
          },
          objectLabels: {
            select: {
              id: true,
              name: true,
              confidence: true,
              category: true,
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
   * No event logging for viewing
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
      skipDuplicates: true,
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
      // Get property details for logging
      const property = await tx.property.findUnique({
        where: { id: data.propertyId },
        select: { userId: true, address: true, city: true },
      });

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

      // Log incident creation
      if (property) {
        await this.logEvent(
          IncidentEventTypes.INCIDENT_CREATED,
          property.userId,
          incident.id.toString(),
          "incident",
          {
            propertyId: data.propertyId,
            propertyAddress: property.address,
            propertyCity: property.city,
            incidentType: incident.incidentType,
            severity: incident.severity,
            status: incident.status,
            description: incident.description.substring(0, 100), // First 100 chars
            aiClassified: incident.aiClassified,
          },
        );

        // Log escalation if it's critical severity
        if (incident.severity === IncidentSeverity.Critical) {
          await this.logEvent(
            IncidentEventTypes.INCIDENT_ESCALATED,
            property.userId,
            incident.id.toString(),
            "incident",
            {
              propertyAddress: property.address,
              incidentType: incident.incidentType,
              severity: IncidentSeverity.Critical,
              description: "Critical incident reported",
            },
          );
        }
      }

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
    // Get current incident for comparison
    const currentIncident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        property: {
          select: { userId: true, address: true },
        },
      },
    });

    if (!currentIncident) {
      throw new Error(`Incident ${id} not found`);
    }

    const updatedIncident = await this.prisma.incident.update({
      where: { id },
      data,
    });

    // Check for severity changes
    if (
      data.severity &&
      currentIncident.severity !== updatedIncident.severity
    ) {
      const severityOrder = {
        [IncidentSeverity.Low]: 1,
        [IncidentSeverity.Medium]: 2,
        [IncidentSeverity.High]: 3,
        [IncidentSeverity.Critical]: 4,
      };

      const isEscalation =
        severityOrder[updatedIncident.severity] >
        severityOrder[currentIncident.severity];

      await this.logEvent(
        isEscalation
          ? IncidentEventTypes.INCIDENT_ESCALATED
          : IncidentEventTypes.INCIDENT_SEVERITY_CHANGED,
        currentIncident.property.userId,
        id.toString(),
        "incident",
        {
          propertyAddress: currentIncident.property.address,
          incidentType: currentIncident.incidentType,
          previousSeverity: currentIncident.severity,
          newSeverity: updatedIncident.severity,
          isEscalation,
        },
      );
    }
    // Log general update for other significant changes
    else if (data.description || data.incidentType) {
      await this.logEvent(
        IncidentEventTypes.INCIDENT_UPDATED,
        currentIncident.property.userId,
        id.toString(),
        "incident",
        {
          propertyAddress: currentIncident.property.address,
          updatedFields: Object.keys(data).filter(
            (key) => data[key as keyof typeof data] !== undefined,
          ),
        },
      );
    }

    return updatedIncident;
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
        select: {
          status: true,
          propertyId: true,
          incidentType: true,
          severity: true,
          reportedAt: true,
        },
      });

      // Get property for user info
      const property = await tx.property.findUnique({
        where: { id: currentIncident.propertyId },
        select: { userId: true, address: true },
      });

      // Calculate property counter changes
      let openIncidentChange = 0;

      const wasOpen =
        currentIncident.status === IncidentStatus.Open ||
        currentIncident.status === IncidentStatus.In_Progress;
      const isNowClosed =
        status === IncidentStatus.Resolved || status === IncidentStatus.Closed;
      const isReopening =
        (currentIncident.status === IncidentStatus.Resolved ||
          currentIncident.status === IncidentStatus.Closed) &&
        (status === IncidentStatus.Open ||
          status === IncidentStatus.In_Progress);

      if (wasOpen && isNowClosed) {
        openIncidentChange = -1;
      } else if (isReopening) {
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

      // Log status change
      if (property) {
        // Calculate resolution time if resolving
        let resolutionTimeHours;
        if (isNowClosed && incident.resolvedAt) {
          resolutionTimeHours =
            (incident.resolvedAt.getTime() -
              currentIncident.reportedAt.getTime()) /
            (1000 * 60 * 60);
        }

        // Log specific event based on status change
        if (isNowClosed) {
          await this.logEvent(
            IncidentEventTypes.INCIDENT_RESOLVED,
            property.userId,
            id.toString(),
            "incident",
            {
              propertyAddress: property.address,
              incidentType: currentIncident.incidentType,
              severity: currentIncident.severity,
              previousStatus: currentIncident.status,
              newStatus: status,
              resolutionTimeHours: resolutionTimeHours?.toFixed(1),
            },
          );
        } else if (isReopening) {
          await this.logEvent(
            IncidentEventTypes.INCIDENT_REOPENED,
            property.userId,
            id.toString(),
            "incident",
            {
              propertyAddress: property.address,
              incidentType: currentIncident.incidentType,
              severity: currentIncident.severity,
              previousStatus: currentIncident.status,
              newStatus: status,
            },
          );
        } else {
          await this.logEvent(
            IncidentEventTypes.INCIDENT_STATUS_CHANGED,
            property.userId,
            id.toString(),
            "incident",
            {
              propertyAddress: property.address,
              incidentType: currentIncident.incidentType,
              previousStatus: currentIncident.status,
              newStatus: status,
            },
          );
        }
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
        select: {
          status: true,
          propertyId: true,
          incidentType: true,
          severity: true,
          description: true,
        },
      });

      // Get property for logging
      const property = await tx.property.findUnique({
        where: { id: incident.propertyId },
        select: { userId: true, address: true },
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

      // Log deletion
      if (property) {
        await this.logEvent(
          IncidentEventTypes.INCIDENT_DELETED,
          property.userId,
          id.toString(),
          "incident",
          {
            propertyAddress: property.address,
            incidentType: incident.incidentType,
            severity: incident.severity,
            status: incident.status,
            wasOpen: decrementOpen > 0,
            description: incident.description.substring(0, 100),
          },
        );
      }

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
    // Get incident and property for logging
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        property: {
          select: { userId: true, address: true },
        },
      },
    });

    await this.prisma.propertyImage.createMany({
      data: images.map((img) => ({
        incidentId,
        imageUrl: img.imageUrl,
        caption: img.caption,
        takenAt: img.takenAt || new Date(),
      })),
    });

    const newImages = await this.prisma.propertyImage.findMany({
      where: { incidentId },
    });

    // Log image addition
    if (incident) {
      await this.logEvent(
        IncidentEventTypes.INCIDENT_IMAGES_ADDED,
        incident.property.userId,
        incidentId.toString(),
        "incident",
        {
          propertyAddress: incident.property.address,
          incidentType: incident.incidentType,
          imageCount: images.length,
          totalImages: newImages.length,
        },
      );
    }

    return newImages;
  }

  /**
   * Upload an image to an property space
   */
  async uploadIncidentImage(
    data: UploadIncidentImageParams,
  ): Promise<PropertyImage> {
    const image = await this.prisma.propertyImage.create({
      data: {
        imageUrl: data.imageUrl,
        caption: data.caption,
        takenAt: data.takenAt,
        incidentId: data.incidentId as number,
        metadata: data.metadata || undefined,
      },
    });

    // Log single image upload
    if (data.incidentId) {
      const incident = await this.prisma.incident.findUnique({
        where: { id: data.incidentId },
        include: {
          property: {
            select: { userId: true, address: true },
          },
        },
      });

      if (incident) {
        await this.logEvent(
          IncidentEventTypes.INCIDENT_IMAGES_ADDED,
          incident.property.userId,
          data.incidentId.toString(),
          "incident",
          {
            propertyAddress: incident.property.address,
            incidentType: incident.incidentType,
            imageCount: 1,
            caption: data.caption,
          },
        );
      }
    }

    return image;
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
   * No event logging for stats queries
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

    const statuses = Object.values(IncidentStatus);
    const severities = Object.values(IncidentSeverity);

    return this.prisma.$transaction(async (tx) => {
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

      const typeCountsWithNames = incidentTypes
        .map((type, i) => ({
          incidentType: type.incidentType,
          count: typeCounts[i],
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

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
