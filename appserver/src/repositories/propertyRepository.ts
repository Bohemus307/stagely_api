import { PrismaClient, Property, PropertyStatus, Prisma } from "@prisma/client";
import { DynamoDBEventRepository } from "./dynamoDB/eventsRepository";

// Event types based on actual schema and user-facing activities
export const PropertyEventTypes = {
  // Property lifecycle events
  PROPERTY_CREATED: "property.created",
  PROPERTY_UPDATED: "property.updated",
  PROPERTY_DELETED: "property.deleted",
  PROPERTY_STATUS_CHANGED: "property.status_changed", // Active -> Maintenance -> Archived
} as const;

// Define query parameters for property listing
export interface PropertyQueryParams {
  page?: number;
  limit?: number;
  userId?: number;
  status?: PropertyStatus;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  country?: string;
  city?: string;
}

// Define property search parameters
export interface PropertySearchParams {
  query: string;
  userId: number;
  limit?: number;
  status?: PropertyStatus;
}

// Define property search result type
export interface PropertySearchResult {
  id: number;
  address: string;
  city: string;
  state: string | null;
  country: string;
  status: PropertyStatus;
  incidentCount: number;
  openIncidentCount: number;
}

// Define property search response
export interface PropertySearchResponse {
  results: PropertySearchResult[];
  count: number;
}

// Define response types with relations
export type PropertyWithRelations = Property & {
  user: {
    id: number;
    firstName: string;
    lastName: string;
  };
  spaces: {
    id: number;
    name: string | null;
    type: string;
  }[];
  _count: {
    incidents: number;
    inspections: number;
    spaces: number;
  };
};

export type PropertyWithFullRelations = Property & {
  user: {
    id: number;
    auth0Id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    profilePictureUrl: string | null;
    lastLogin: Date | null;
  };
  spaces: {
    id: number;
    name: string | null;
    type: string;
    aiGenerated: boolean;
    confidenceScore: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
    images: {
      id: number;
      imageUrl: string;
      caption: string | null;
      takenAt: Date;
    }[];
  }[];
  inspections: {
    id: number;
    title: string;
    description: string | null;
    inspectionDate: Date;
    photos: {
      id: number;
      imageUrl: string;
      caption: string | null;
      takenAt: Date;
      spaceId: number | null;
    }[];
  }[];
  incidents: {
    id: number;
    incidentType: string;
    description: string;
    reportedAt: Date;
    resolvedAt: Date | null;
    severity: string;
    status: string;
    images: {
      id: number;
      imageUrl: string;
      caption: string | null;
    }[];
  }[];
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

// Define user property stats type
export interface UserPropertyStats {
  totalProperties: number;
  activeProperties: number;
  maintenanceProperties: number;
  archivedProperties: number;
  totalIncidents: number;
  openIncidents: number;
}

/**
 * Repository for property-related database operations with event logging
 */
export class PropertyRepository {
  private prisma: PrismaClient;
  private eventRepo: DynamoDBEventRepository | null;

  constructor(prisma: PrismaClient, eventRepo?: DynamoDBEventRepository) {
    this.prisma = prisma;
    this.eventRepo = eventRepo || null;
  }

  /**
   * Helper method to log events safely
   */
  private async logEvent(
    eventType: string,
    userId?: number,
    entityId?: string,
    entityType: string = "property",
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
        "property-service",
      );
    } catch (error) {
      console.error("Failed to log event:", error);
    }
  }

  /**
   * Get properties with pagination and filtering
   * No event logging - viewing is not a meaningful event
   */
  async getProperties(
    params: PropertyQueryParams,
  ): Promise<PaginatedResponse<PropertyWithRelations>> {
    const {
      page = 1,
      limit = 10,
      userId,
      status,
      search,
      sortBy = "updatedAt",
      sortOrder = "desc",
      country,
      city,
    } = params;

    // Build filter conditions
    const where: Prisma.PropertyWhereInput = {};

    if (userId) {
      where.userId = userId;
    }

    if (status) {
      where.status = status;
    }

    if (country) {
      where.country = country;
    }

    if (city) {
      where.city = city;
    }

    if (search) {
      where.OR = [
        { address: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { state: { contains: search, mode: "insensitive" } },
        { country: { contains: search, mode: "insensitive" } },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Build sort order
    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    // Execute count query for pagination metadata
    const total = await this.prisma.property.count({ where });

    // Execute main query with relations
    const properties = await this.prisma.property.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        spaces: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        _count: {
          select: {
            incidents: true,
            inspections: true,
            spaces: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    });

    return {
      data: properties as PropertyWithRelations[],
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Search properties by query string
   * No event logging for searches
   */
  async searchProperties(params: {
    query?: string;
    userId: number;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<any>> {
    const { query = "", userId, page = 1, limit = 10 } = params;

    // Build the where clause
    const where: Prisma.PropertyWhereInput = {
      userId,
    };

    // Only add search conditions if query is not empty
    if (query.trim()) {
      where.OR = [
        { address: { contains: query.trim(), mode: "insensitive" } },
        { city: { contains: query.trim(), mode: "insensitive" } },
        { country: { contains: query.trim(), mode: "insensitive" } },
        { state: { contains: query.trim(), mode: "insensitive" } },
        { zipCode: { contains: query.trim(), mode: "insensitive" } },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get count for pagination metadata
    const total = await this.prisma.property.count({ where });

    // Get results
    const properties = await this.prisma.property.findMany({
      where,
      select: {
        id: true,
        address: true,
        city: true,
        state: true,
        country: true,
        status: true,
        zipCode: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            incidents: true,
            inspections: true,
            spaces: true,
          },
        },
      },
      skip,
      take: limit,
      orderBy: [{ updatedAt: "desc" }],
    });

    return {
      data: properties,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a property by ID with all relations
   * No event logging for viewing
   */
  async getPropertyById(id: number): Promise<PropertyWithFullRelations | null> {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            auth0Id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            profilePictureUrl: true,
            lastLogin: true,
          },
        },
        spaces: {
          include: {
            images: {
              select: {
                id: true,
                imageUrl: true,
                caption: true,
                takenAt: true,
              },
            },
          },
        },
        inspections: {
          include: {
            photos: {
              select: {
                id: true,
                imageUrl: true,
                caption: true,
                takenAt: true,
                spaceId: true,
              },
            },
          },
        },
        incidents: {
          include: {
            images: {
              select: {
                id: true,
                imageUrl: true,
                caption: true,
              },
            },
          },
        },
      },
    });

    return property as PropertyWithFullRelations | null;
  }

  /**
   * Create a new property
   */
  async createProperty(
    data: {
      address: string;
      city: string;
      state?: string | null;
      zipCode?: string | null;
      country: string;
      latitude: number | Prisma.Decimal;
      longitude: number | Prisma.Decimal;
      status: PropertyStatus;
    },
    userId: number,
  ): Promise<Property> {
    const property = await this.prisma.property.create({
      data: {
        ...data,
        userId,
      },
    });

    // Log property creation event
    await this.logEvent(
      PropertyEventTypes.PROPERTY_CREATED,
      userId,
      property.id.toString(),
      "property",
      {
        address: property.address,
        city: property.city,
        state: property.state,
        country: property.country,
        status: property.status,
      },
    );

    return property;
  }

  /**
   * Update a property
   */
  async updateProperty(
    id: number,
    data: {
      address?: string;
      city?: string;
      state?: string | null;
      zipCode?: string | null;
      country?: string;
      latitude?: number | Prisma.Decimal;
      longitude?: number | Prisma.Decimal;
      imageUrl?: string;
      status?: PropertyStatus;
    },
  ): Promise<Property> {
    // Get current property for comparison
    const currentProperty = await this.prisma.property.findUnique({
      where: { id },
      select: {
        status: true,
        userId: true,
        address: true,
      },
    });

    if (!currentProperty) {
      throw new Error(`Property ${id} not found`);
    }

    const updatedProperty = await this.prisma.property.update({
      where: { id },
      data,
    });

    // Log status changes as a special event
    if (data.status && currentProperty.status !== data.status) {
      await this.logEvent(
        PropertyEventTypes.PROPERTY_STATUS_CHANGED,
        currentProperty.userId,
        id.toString(),
        "property",
        {
          address: currentProperty.address,
          previousStatus: currentProperty.status,
          newStatus: data.status,
        },
      );
    }
    // Log significant updates (address, location changes)
    else if (data.address || data.city || data.state || data.country) {
      const changedFields = Object.keys(data).filter(
        (key) =>
          data[key as keyof typeof data] !== undefined && key !== "imageUrl", // Don't log image updates
      );

      await this.logEvent(
        PropertyEventTypes.PROPERTY_UPDATED,
        currentProperty.userId,
        id.toString(),
        "property",
        {
          address: updatedProperty.address,
          updatedFields: changedFields,
        },
      );
    }
    // Don't log minor updates like imageUrl changes

    return updatedProperty;
  }

  /**
   * Delete a property
   */
  async deleteProperty(id: number): Promise<Property> {
    // Get property details before deletion
    const propertyToDelete = await this.prisma.property.findUnique({
      where: { id },
      select: {
        userId: true,
        address: true,
        city: true,
        status: true,
        incidentCount: true,
        openIncidentCount: true,
        _count: {
          select: {
            spaces: true,
            inspections: true,
          },
        },
      },
    });

    if (!propertyToDelete) {
      throw new Error(`Property ${id} not found`);
    }

    const deletedProperty = await this.prisma.property.delete({
      where: { id },
    });

    // Log deletion with context about what was deleted
    await this.logEvent(
      PropertyEventTypes.PROPERTY_DELETED,
      propertyToDelete.userId,
      id.toString(),
      "property",
      {
        address: propertyToDelete.address,
        city: propertyToDelete.city,
        hadOpenIncidents: propertyToDelete.openIncidentCount > 0,
        stats: {
          totalIncidents: propertyToDelete.incidentCount,
          openIncidents: propertyToDelete.openIncidentCount,
          spaces: propertyToDelete._count.spaces,
          inspections: propertyToDelete._count.inspections,
        },
      },
    );

    return deletedProperty;
  }

  /**
   * Get property statistics for a user
   */
  async getUserPropertyStats(userId: number): Promise<UserPropertyStats> {
    // Get total properties count
    const totalProperties = await this.prisma.property.count({
      where: { userId },
    });

    // Get counts by status
    const activeProperties = await this.prisma.property.count({
      where: { userId, status: PropertyStatus.Active },
    });

    const maintenanceProperties = await this.prisma.property.count({
      where: { userId, status: PropertyStatus.Maintenance },
    });

    const archivedProperties = await this.prisma.property.count({
      where: { userId, status: PropertyStatus.Archived },
    });

    // Get total incidents count
    const totalIncidents = await this.prisma.incident.count({
      where: {
        property: { userId },
      },
    });

    // Get open incidents count
    const openIncidents = await this.prisma.incident.count({
      where: {
        property: { userId },
        status: { in: ["Open", "In_Progress"] },
      },
    });

    return {
      totalProperties,
      activeProperties,
      maintenanceProperties,
      archivedProperties,
      totalIncidents,
      openIncidents,
    };
  }

  /**
   * Get property spaces
   */
  async getPropertySpaces(propertyId: number) {
    return this.prisma.propertySpace.findMany({
      where: { propertyId },
      include: {
        images: {
          select: {
            id: true,
            imageUrl: true,
            caption: true,
            takenAt: true,
            metadata: true,
          },
        },
      },
    });
  }

  /**
   * Get property inspections
   */
  async getPropertyInspections(propertyId: number) {
    return this.prisma.inspection.findMany({
      where: { propertyId },
      include: {
        photos: {
          select: {
            id: true,
            imageUrl: true,
            caption: true,
            takenAt: true,
            spaceId: true,
            metadata: true,
          },
        },
      },
    });
  }

  /**
   * Get property incidents
   */
  async getPropertyIncidents(propertyId: number) {
    return this.prisma.incident.findMany({
      where: { propertyId },
      include: {
        images: {
          select: {
            id: true,
            imageUrl: true,
            caption: true,
          },
        },
      },
    });
  }
}
