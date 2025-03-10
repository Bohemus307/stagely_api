// src/repositories/property-repository.ts
import {
  PrismaClient,
  Property,
  PropertyStatus,
  User,
  PropertyImage,
  Incident,
} from "@prisma/client";

// Define types for query parameters
export interface PropertyQueryParams {
  page?: number;
  limit?: number;
  status?: PropertyStatus;
  country?: string;
  city?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  userId?: number;
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

// Define property with included relations type
export interface PropertyWithRelations extends Property {
  user: Pick<User, "id" | "firstName" | "lastName">;
  images: PropertyImage[];
  _count: {
    incidents: number;
  };
}

// Define property with full relations type
export interface PropertyWithFullRelations extends Property {
  user: Pick<
    User,
    "id" | "firstName" | "lastName" | "email" | "phone" | "profilePictureUrl"
  >;
  images: PropertyImage[];
  incidents: (Incident & {
    images: {
      id: number;
      imageUrl: string;
      caption: string | null;
    }[];
  })[];
}

// Define user property stats type
export interface UserPropertyStats {
  propertiesByStatus: {
    status: PropertyStatus;
    _count: number;
  }[];
  openIncidentsCount: number;
  recentIncidents: Incident[];
}

/**
 * Repository for handling Property-related database operations
 */
export class PropertyRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get properties with pagination, filtering and sorting
   */
  async getProperties({
    page = 1,
    limit = 10,
    status,
    country,
    city,
    sortBy = "updatedAt",
    sortOrder = "desc",
    userId,
  }: PropertyQueryParams): Promise<PaginatedResponse<PropertyWithRelations>> {
    const skip = (page - 1) * limit;

    // Build where conditions
    const where: any = {};
    if (status) where.status = status;
    if (country) where.country = country;
    if (city) where.city = city;
    if (userId) where.userId = userId;

    // Build sorting
    const orderBy: any = {};
    orderBy[sortBy] = sortOrder.toLowerCase();

    const [properties, total] = await Promise.all([
      this.prisma.property.findMany({
        skip,
        take: limit,
        where,
        orderBy,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          // Only include the first 3 images for preview
          images: {
            take: 3,
            orderBy: {
              createdAt: "desc",
            },
          },
          _count: {
            select: {
              incidents: true,
            },
          },
        },
      }),
      this.prisma.property.count({ where }),
    ]);

    return {
      data: properties,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get property by ID with all related data
   */
  async getPropertyById(id: number): Promise<PropertyWithFullRelations> {
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            profilePictureUrl: true,
          },
        },
        images: true,
        incidents: {
          orderBy: {
            reportedAt: "desc",
          },
          include: {
            images: true,
          },
        },
      },
    });

    return property;
  }

  /**
   * Create a new property
   */
  async createProperty(
    data: Omit<
      Property,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "incidentCount"
      | "openIncidentCount"
      | "lastIncidentAt"
    >,
    userId: number,
  ): Promise<Property> {
    return this.prisma.property.create({
      data: {
        ...data,
        userId,
      },
    });
  }

  /**
   * Update a property
   */
  async updateProperty(
    id: number,
    data: Partial<Omit<Property, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Property> {
    return this.prisma.property.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a property
   */
  async deleteProperty(id: number): Promise<Property> {
    return this.prisma.property.delete({
      where: { id },
    });
  }

  /**
   * Get property statistics for a user
   */
  async getUserPropertyStats(userId: number): Promise<UserPropertyStats> {
    const stats = await this.prisma.$transaction([
      // Count properties by status
      this.prisma.property.groupBy({
        by: ["status"],
        where: { userId },
        _count: true,
        orderBy: {
          status: "asc",
        },
      }),

      // Get open incidents count
      this.prisma.incident.count({
        where: {
          property: { userId },
          status: { in: ["Open", "In_Progress"] },
        },
      }),

      // Get recent incidents
      this.prisma.incident.findMany({
        where: {
          property: { userId },
        },
        orderBy: { reportedAt: "desc" },
        take: 5,
        include: {
          property: {
            select: { address: true, city: true },
          },
        },
      }),
    ]);

    return {
      propertiesByStatus: stats[0].map((item) => ({
        status: item.status,
        _count: (item as any)._count,
      })),
      openIncidentsCount: stats[1],
      recentIncidents: stats[2],
    };
  }
}
