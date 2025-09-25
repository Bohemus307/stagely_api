import { PrismaClient, User, Property } from "@prisma/client";

// Define types for query parameters
export interface UserQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
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

// Define user with included relations type
export interface UserWithRelations extends User {
  _count: {
    properties: number;
  };
}

// Define user with full relations type
export interface UserWithFullRelations extends User {
  properties: (Property & {
    _count: {
      incidents: number;
    };
  })[];
}

// Define user stats type
export interface UserStats {
  totalProperties: number;
  activeProperties: number;
  totalIncidents: number;
  openIncidents: number;
  recentActivity: {
    type: "property_created" | "incident_reported";
    timestamp: Date;
    details: any;
  }[];
}

/**
 * Repository for handling User-related database operations
 */
export class UserRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get users with pagination, filtering and sorting
   */
  async getUsers({
    page = 1,
    limit = 10,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
  }: UserQueryParams): Promise<PaginatedResponse<UserWithRelations>> {
    const skip = (page - 1) * limit;

    // Build where conditions
    const where: any = {
      isDeleted: false
    };
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    // Build sorting
    const orderBy: any = {};
    orderBy[sortBy] = sortOrder.toLowerCase();

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        where,
        orderBy,
        include: {
          _count: {
            select: {
              properties: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user by ID with all related data
   */
  async getUserById(id: number): Promise<UserWithFullRelations> {
    const user = await this.prisma.user.findFirst({
      where: { id, isDeleted: false },
      include: {
        properties: {
          include: {
            _count: {
              select: {
                incidents: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
    throw new Error("User not found");
  }
    return user;
  }

  /**
   * Get user by Auth0 ID
   */
  async getUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { auth0Id, isDeleted: false },
    });
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email, isDeleted: false },
    });
  }

  /**
   * Create a new user
   */
  async createUser(
    data: Omit<User, "id" | "createdAt" | "updatedAt">,
  ): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  /**
   * Update a user
   */
  async updateUser(
    id: number,
    data: Partial<Omit<User, "id" | "auth0Id" | "createdAt" | "updatedAt">>,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a user
   */
  async deleteUser(id: number): Promise<User> {
    return this.prisma.user.delete({
      where: { id },
    });
  }

  /**
   * Update user's last login timestamp
   */
  async updateLastLogin(id: number): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        lastLogin: new Date(),
      },
    });
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: number): Promise<UserStats> {
    const stats = await this.prisma.$transaction([
      // Count total properties
      this.prisma.property.count({
        where: { userId },
      }),

      // Count active properties
      this.prisma.property.count({
        where: {
          userId,
          status: "Active",
        },
      }),

      // Count total incidents
      this.prisma.incident.count({
        where: {
          property: { userId },
        },
      }),

      // Count open incidents
      this.prisma.incident.count({
        where: {
          property: { userId },
          status: { in: ["Open", "In_Progress"] },
        },
      }),

      // Get recent properties created
      this.prisma.property.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          id: true,
          address: true,
          city: true,
          country: true,
          createdAt: true,
        },
      }),

      // Get recent incidents reported
      this.prisma.incident.findMany({
        where: {
          property: { userId },
        },
        orderBy: { reportedAt: "desc" },
        take: 3,
        select: {
          id: true,
          incidentType: true,
          severity: true,
          status: true,
          reportedAt: true,
          property: {
            select: {
              id: true,
              address: true,
            },
          },
        },
      }),
    ]);

    // Format recent activity
    const recentProperties = stats[4].map((property) => ({
      type: "property_created" as const,
      timestamp: property.createdAt,
      details: property,
    }));

    const recentIncidents = stats[5].map((incident) => ({
      type: "incident_reported" as const,
      timestamp: incident.reportedAt,
      details: incident,
    }));

    // Combine and sort recent activity
    const recentActivity = [...recentProperties, ...recentIncidents]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5);

    return {
      totalProperties: stats[0],
      activeProperties: stats[1],
      totalIncidents: stats[2],
      openIncidents: stats[3],
      recentActivity,
    };
  }

  /**
 * Get multiple users by their IDs
 * @param ids - Array of user IDs to retrieve
 * @returns Array of found users
 */
async getUsersByIds(ids: number[]): Promise<User[]> {
  if (!ids.length) return [];

  return this.prisma.user.findMany({
    where: {
      id: { in: ids },
      isDeleted: false
    }
  });
}

  /**
   * Check if email exists for another user
   */
  async isEmailTaken(email: string, excludeUserId?: number): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: {
        email,
        isDeleted: false,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });

    return count > 0;
  }

  /**
   * Search users by name or email
   */
  async searchUsers(
    query: string,
    limit: number = 5,
  ): Promise<
    Pick<
      User,
      "id" | "firstName" | "lastName" | "email" | "profilePictureUrl"
    >[]
  > {
    return this.prisma.user.findMany({
      where: {
        isDeleted: false,
        OR: [
          { firstName: { contains: query, mode: "insensitive" } },
          { lastName: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profilePictureUrl: true,
      },
      take: limit,
    });
  }



/**
 * Find an active user by email
 */
async findActiveUserByEmail(email: string): Promise<User | null> {
  return this.prisma.user.findFirst({
    where: {
      email,
      isPlaceholder: false,
      isDeleted: false
    }
  });
}

/**
 * Find a valid invitation (placeholder user) by email
 */
async findValidInvitationByEmail(email: string): Promise<User | null> {
  return this.prisma.user.findFirst({
    where: {
      email,
      isPlaceholder: true,
      expiresAt: {
        gt: new Date()
      }
    }
  });
}

/**
 * Find a placeholder user by invitation token
 */
async findByInvitationToken(token: string): Promise<User | null> {
  return this.prisma.user.findFirst({
    where: {
      invitationToken: token,
      isPlaceholder: true,
      expiresAt: {
        gt: new Date()
      }
    }
  });
}

/**
 * Create a placeholder user for invitation
 */
async createPlaceholderUser(params: {
  email: string;
  invitationToken: string;
  invitedById: number;
  expiresAt: Date;
}): Promise<User> {
  return this.prisma.user.create({
    data: {
      email: params.email,
      firstName: "Invited",
      lastName: "User",
      auth0Id: `placeholder-${params.invitationToken}`,
      isPlaceholder: true,
      invitationToken: params.invitationToken,
      invitedById: params.invitedById,
      expiresAt: params.expiresAt
    }
  });
}

/**
 * Get users that have previously messaged with the given user
 * @param participantIds - Array of user IDs from conversations
 * @param search - Optional search query to filter users
 * @param excludeInvited - Whether to exclude placeholder/invited users
 * @param limit - Maximum number of results
 */
async getPreviouslyMessagedUsers({
  participantIds,
  search,
  excludeInvited = true,
  limit = 20
}: {
  participantIds: number[];
  search?: string;
  excludeInvited?: boolean;
  limit?: number;
}): Promise<Pick<User, "id" | "firstName" | "lastName" | "email" | "profilePictureUrl" | "createdAt">[]> {

  if (participantIds.length === 0) {
    return [];
  }

  const whereConditions: any = {
    id: {
      in: participantIds
    },
    isDeleted: false
  };

  // Add search filter if provided
  if (search && search.trim().length >= 2) {
    const searchTerm = search.trim();
    whereConditions.OR = [
      {
        firstName: {
          contains: searchTerm,
          mode: 'insensitive'
        }
      },
      {
        lastName: {
          contains: searchTerm,
          mode: 'insensitive'
        }
      },
      {
        email: {
          contains: searchTerm,
          mode: 'insensitive'
        }
      }
    ];
  }

  if (excludeInvited) {
    whereConditions.isPlaceholder = false;
  }

  return this.prisma.user.findMany({
    where: whereConditions,
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      profilePictureUrl: true,
      createdAt: true
    },
    orderBy: {
      firstName: 'asc'
    }
  });
}
}
