import { PrismaClient, Property, PropertyStatus, Prisma } from "@prisma/client";
import {
  PropertyRepository,
  PropertyQueryParams,
  PaginatedResponse,
  PropertyWithRelations,
  PropertyWithFullRelations,
  UserPropertyStats,
} from "../../repositories/propertyRepository";
import { NotFoundError } from "../../utils/errors";
import { DynamoDBEventRepository } from "../../repositories/dynamoDB/eventsRepository";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface CreatePropertyInput {
  address: string;
  city: string;
  state?: string | null;
  zipCode?: string | null;
  country: string;
  latitude: number | Prisma.Decimal;
  longitude: number | Prisma.Decimal;
  status?: PropertyStatus;
}

export interface UpdatePropertyInput {
  address?: string;
  city?: string;
  state?: string | null;
  zipCode?: string | null;
  country?: string;
  latitude?: number | Prisma.Decimal;
  longitude?: number | Prisma.Decimal;
  imageUrl?: string;
  status?: PropertyStatus;
}

/**
 * Service for property-related business logic
 */
export class PropertyService {
  private propertyRepo: PropertyRepository;

  constructor(prisma: PrismaClient, dynamoDBClient: DynamoDBDocumentClient) {
    const eventRepo = new DynamoDBEventRepository(dynamoDBClient);
    this.propertyRepo = new PropertyRepository(prisma, eventRepo);
  }

  /**
   * Get properties with pagination and filtering
   */
  async getProperties(
    queryParams: PropertyQueryParams,
  ): Promise<PaginatedResponse<PropertyWithRelations>> {
    return this.propertyRepo.getProperties(queryParams);
  }

  /**
   * Search properties by query string
   *
   * @param query - The search term (optional)
   * @param userId - The ID of the user whose properties to search
   * @param page - Page number
   * @param limit - Number of results per page
   * @returns Paginated response of matching properties
   */
  async searchProperties(
    query: string = "",
    userId: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponse<any>> {
    return this.propertyRepo.searchProperties({
      query,
      userId,
      page,
      limit,
    });
  }

  /**
   * Get a property by ID
   */
  async getPropertyById(id: number): Promise<PropertyWithFullRelations> {
    const property = await this.propertyRepo.getPropertyById(id);

    if (!property) {
      throw new NotFoundError(`Property with ID ${id} not found`);
    }

    return property;
  }

  /**
   * Create a new property
   */
  async createProperty(
    data: CreatePropertyInput,
    userId: number,
  ): Promise<Property> {
    // Business logic validations can go here
    const finalData = {
      ...data,
      status: data.status || PropertyStatus.Active,
    };

    return this.propertyRepo.createProperty(finalData, userId);
  }

  /**
   * Update a property
   */
  async updateProperty(
    id: number,
    data: UpdatePropertyInput,
  ): Promise<Property> {
    // First check if property exists
    const property = await this.propertyRepo.getPropertyById(id);

    if (!property) {
      throw new NotFoundError(`Property with ID ${id} not found`);
    }

    return this.propertyRepo.updateProperty(id, data);
  }

  /**
   * Change property status
   */
  async changePropertyStatus(
    id: number,
    status: PropertyStatus,
  ): Promise<Property> {
    // First check if property exists
    const property = await this.propertyRepo.getPropertyById(id);

    if (!property) {
      throw new NotFoundError(`Property with ID ${id} not found`);
    }

    return this.propertyRepo.updateProperty(id, { status });
  }

  /**
   * Delete a property
   */
  async deleteProperty(id: number): Promise<Property> {
    // First check if property exists
    const property = await this.propertyRepo.getPropertyById(id);

    if (!property) {
      throw new NotFoundError(`Property with ID ${id} not found`);
    }

    return this.propertyRepo.deleteProperty(id);
  }

  /**
   * Get property statistics for a user
   */
  async getUserPropertyStats(userId: number): Promise<UserPropertyStats> {
    return this.propertyRepo.getUserPropertyStats(userId);
  }

  /**
   * Get property spaces
   */
  async getPropertySpaces(propertyId: number) {
    const property = await this.propertyRepo.getPropertyById(propertyId);

    if (!property) {
      throw new NotFoundError(`Property with ID ${propertyId} not found`);
    }

    return this.propertyRepo.getPropertySpaces(propertyId);
  }

  /**
   * Get property inspections
   */
  async getPropertyInspections(propertyId: number) {
    const property = await this.propertyRepo.getPropertyById(propertyId);

    if (!property) {
      throw new NotFoundError(`Property with ID ${propertyId} not found`);
    }

    return this.propertyRepo.getPropertyInspections(propertyId);
  }

  /**
   * Get property incidents
   */
  async getPropertyIncidents(propertyId: number) {
    const property = await this.propertyRepo.getPropertyById(propertyId);

    if (!property) {
      throw new NotFoundError(`Property with ID ${propertyId} not found`);
    }

    return this.propertyRepo.getPropertyIncidents(propertyId);
  }
}
