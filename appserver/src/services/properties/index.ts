import { Property, PropertyStatus, Prisma } from "@prisma/client";
import {
  PropertyRepository,
  PropertyQueryParams,
  PaginatedResponse,
  PropertyWithRelations,
  PropertyWithFullRelations,
  UserPropertyStats,
} from "../../repositories/propertyRepository";
import { NotFoundError } from "../../utils/errors";
import { EventMetadata } from "../../repositories/dynamoDB/eventsRepository";

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
  status?: PropertyStatus;
}

/**
 * Service for property-related business logic
 */
export class PropertyService {
  private propertyRepo: PropertyRepository;

  constructor(propertyRepository: PropertyRepository) {
  this.propertyRepo = propertyRepository;
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
  async getPropertyById(id: number, userId?: number, metadata?: EventMetadata): Promise<PropertyWithFullRelations> {
    const property = await this.propertyRepo.getPropertyById(id, userId, metadata);

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
    requestUserId?: number,
    metadata?: EventMetadata
  ): Promise<Property> {
    // Business logic validations can go here
    const finalData = {
      ...data,
      status: data.status || PropertyStatus.Active,
    };

    return this.propertyRepo.createProperty(finalData, userId, requestUserId, metadata);
  }

  /**
   * Update a property
   */
  async updateProperty(
    id: number,
    data: UpdatePropertyInput,
    userId?: number,
    metadata?: EventMetadata
  ): Promise<Property> {
    // First check if property exists
    const property = await this.propertyRepo.getPropertyById(id, userId, metadata);

    if (!property) {
      throw new NotFoundError(`Property with ID ${id} not found`);
    }

    return this.propertyRepo.updateProperty(id, data, userId, metadata);
  }

  /**
   * Change property status
   */
  async changePropertyStatus(
    id: number,
    status: PropertyStatus,
    userId?: number,
    metadata?: EventMetadata
  ): Promise<Property> {
    // First check if property exists
    const property = await this.propertyRepo.getPropertyById(id, userId, metadata);

    if (!property) {
      throw new NotFoundError(`Property with ID ${id} not found`);
    }

    return this.propertyRepo.updateProperty(id, { status }, userId, metadata);
  }

  /**
   * Delete a property
   */
  async deleteProperty(id: number, userId?: number,
    metadata?: EventMetadata): Promise<Property> {
    // First check if property exists
    const property = await this.propertyRepo.getPropertyById(id, userId, metadata);

    if (!property) {
      throw new NotFoundError(`Property with ID ${id} not found`);
    }

    return this.propertyRepo.deleteProperty(id, userId, metadata);
  }

  /**
   * Get property statistics for a user
   */
  async getUserPropertyStats(userId: number, requestUserId?: number,
    metadata?: EventMetadata): Promise<UserPropertyStats> {
    return this.propertyRepo.getUserPropertyStats(userId, requestUserId, metadata);
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
