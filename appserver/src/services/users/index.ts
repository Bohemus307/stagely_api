import { PrismaClient, User } from "@prisma/client";
import {
  UserRepository,
  UserQueryParams,
  UserWithFullRelations,
  UserStats,
} from "../../repositories/userRepository";
import { NotFoundError, ConflictError } from "../../utils/errors";
import { MessagingService } from "../messaging";

/**
 * Service for handling user-related operations
 */
export class UserService {
  private repository: UserRepository;
  private messagingService?: MessagingService;

  constructor(prisma: PrismaClient, dynamoClient?: any) {
    this.repository = new UserRepository(prisma);
    if (dynamoClient) {
      this.messagingService = new MessagingService(prisma, dynamoClient);
    }
  }

  /**
   * Get users with pagination, filtering and sorting
   */
  async getUsers(params: UserQueryParams) {
    return this.repository.getUsers(params);
  }

  /**
   * Get a user by ID
   */
  async getUserById(id: number): Promise<UserWithFullRelations> {
    try {
      return await this.repository.getUserById(id);
    } catch (err) {
      throw new NotFoundError("User not found");
    }
  }

  /**
   * Get a user by Auth0 ID
   */
  async getUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.repository.getUserByAuth0Id(auth0Id);
  }

  /**
   * Create a new user or accept an invitation if one exists
   */
  async createUser(
    data: Omit<User, "id" | "createdAt" | "updatedAt">,
  ): Promise<User> {
    // Check if there's an existing invitation for this email
    const existingInvitation = await this.repository.findValidInvitationByEmail(
      data.email,
    );

    if (existingInvitation) {
      // Update the existing invitation instead of creating a new user
      return this.repository.updateUser(existingInvitation.id, {
        firstName: data.firstName,
        lastName: data.lastName,
        profilePictureUrl: data.profilePictureUrl,
        isPlaceholder: false,
        invitationToken: null,
        expiresAt: null,
        // Copy any other relevant fields from data that should be updated
      });
    }

    // No invitation exists, proceed with normal user creation

    // Check if email is already taken
    const emailExists = await this.repository.isEmailTaken(data.email);
    if (emailExists) {
      throw new ConflictError("Email already in use");
    }

    // Check if Auth0 ID already exists
    const existingUser = await this.repository.getUserByAuth0Id(data.auth0Id);
    if (existingUser) {
      throw new ConflictError("Auth0 ID already registered");
    }

    return this.repository.createUser(data);
  }

  /**
   * Update a user
   */
  async updateUser(
    id: number,
    data: Partial<Omit<User, "id" | "auth0Id" | "createdAt" | "updatedAt">>,
  ): Promise<User> {
    // Check if user exists
    const user = await this.repository.getUserById(id).catch(() => {
      throw new NotFoundError("User not found");
    });

    // If email is being updated, check if it's already taken
    if (data.email && data.email !== user.email) {
      const emailExists = await this.repository.isEmailTaken(data.email, id);
      if (emailExists) {
        throw new ConflictError("Email already in use");
      }
    }

    return this.repository.updateUser(id, data);
  }

  /**
   * Delete a user
   */
  async deleteUser(id: number): Promise<User> {
    // Check if user exists
    await this.repository.getUserById(id).catch(() => {
      throw new NotFoundError("User not found");
    });

    return this.repository.deleteUser(id);
  }

  /**
   * Update user's last login timestamp
   */
  async updateLastLogin(id: number): Promise<User> {
    // Check if user exists
    await this.repository.getUserById(id).catch(() => {
      throw new NotFoundError("User not found");
    });

    return this.repository.updateLastLogin(id);
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: number): Promise<UserStats> {
    // Check if user exists
    await this.repository.getUserById(userId).catch(() => {
      throw new NotFoundError("User not found");
    });

    return this.repository.getUserStats(userId);
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
    if (!query || query.length < 2) {
      return [];
    }

    return this.repository.searchUsers(query, limit);
  }

    /**
   * Get users that the current user has previously messaged
   * @param userId - Current user ID
   * @param search - Optional search query to filter users
   * @param excludeInvited - Whether to exclude placeholder/invited users
   * @param limit - Maximum number of results
   */
  async getPreviouslyMessagedUsers({
    userId,
    search,
    excludeInvited = true,
    limit = 20
  }: {
    userId: number;
    search?: string;
    excludeInvited?: boolean;
    limit?: number;
  }): Promise<{ users: any[]; total: number }> {

    if (!this.messagingService) {
      throw new Error("Messaging service not available - DynamoDB client not provided");
    }

    // Verify user exists
    const user = await this.repository.getUserById(userId);
    if (!user) {
      throw new NotFoundError(`User not found: ${userId}`);
    }

    // Get all conversations for the user from DynamoDB
    const { conversations } = await this.messagingService.getConversationsForUser(userId, 100);

    if (conversations.length === 0) {
      return { users: [], total: 0 };
    }

    // Extract unique participant IDs (excluding the current user)
    const participantIds = new Set<number>();

    conversations.forEach(conversation => {
      conversation.participants.forEach(participantId => {
        if (participantId !== userId) {
          participantIds.add(participantId);
        }
      });
    });

    if (participantIds.size === 0) {
      return { users: [], total: 0 };
    }

    // Use repository method to get users (following your architecture pattern)
    const users = await this.repository.getPreviouslyMessagedUsers({
      participantIds: Array.from(participantIds),
      search,
      excludeInvited,
      limit
    });

    return {
      users,
      total: users.length
    };
  }
}
