import { PrismaClient, User } from "@prisma/client";
import {
  UserRepository,
  UserQueryParams,
  UserWithFullRelations,
  UserStats,
} from "../../repositories/userRepository";
import { NotFoundError, ConflictError } from "../../utils/errors";

/**
 * Service for handling user-related operations
 */
export class UserService {
  private repository: UserRepository;

  constructor(prisma: PrismaClient) {
    this.repository = new UserRepository(prisma);
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
   * Create a new user
   */
  async createUser(
    data: Omit<User, "id" | "createdAt" | "updatedAt">,
  ): Promise<User> {
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
}
