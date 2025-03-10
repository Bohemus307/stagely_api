// src/services/property-service.ts
import { PrismaClient, Property, PropertyStatus } from "@prisma/client";
import {
  PropertyRepository,
  PropertyQueryParams,
  PaginatedResponse,
  PropertyWithRelations,
  PropertyWithFullRelations,
  UserPropertyStats,
} from "../../repositories/propertyRepository";
import { UnauthorizedError } from "../../utils/errors";

// Define property create/update input types
export interface CreatePropertyInput
  extends Omit<
    Property,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "incidentCount"
    | "openIncidentCount"
    | "lastIncidentAt"
  > {
  // Add any additional validation or optional fields
}

export interface UpdatePropertyInput
  extends Partial<
    Omit<
      Property,
      | "id"
      | "userId"
      | "createdAt"
      | "updatedAt"
      | "incidentCount"
      | "openIncidentCount"
      | "lastIncidentAt"
    >
  > {
  // Add any additional validation or fields
}

/**
 * Service for property-related business logic
 */
export class PropertyService {
  private propertyRepo: PropertyRepository;

  constructor(prisma: PrismaClient) {
    this.propertyRepo = new PropertyRepository(prisma);
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
   * Get a property by ID with authorization check
   */
  async getPropertyById(
    id: number,
    userId: number,
    isAdmin: boolean = false,
  ): Promise<PropertyWithFullRelations> {
    const property = await this.propertyRepo.getPropertyById(id);

    // Authorization check - only owner or admin can access property details
    if (!isAdmin && property.userId !== userId) {
      throw new UnauthorizedError(
        "You do not have permission to access this property",
      );
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
    // For example, geocoding the address if not provided
    let finalData = { ...data };

    if (!data.latitude || !data.longitude) {
      // You would use a geocoding service here
      // For example: const coordinates = await geocodeAddress(data.address, data.city);
      // finalData.latitude = coordinates.latitude;
      // finalData.longitude = coordinates.longitude;
    }

    return this.propertyRepo.createProperty(
      {
        ...finalData,
        status: data.status || PropertyStatus.Active,
      },
      userId,
    );
  }

  /**
   * Update a property with authorization check
   */
  async updateProperty(
    id: number,
    data: UpdatePropertyInput,
    userId: number,
    isAdmin: boolean = false,
  ): Promise<Property> {
    // First check if property exists and user has access
    const property = await this.propertyRepo.getPropertyById(id);

    if (!isAdmin && property.userId !== userId) {
      throw new UnauthorizedError(
        "You do not have permission to update this property",
      );
    }

    return this.propertyRepo.updateProperty(id, data);
  }

  /**
   * Change property status with authorization check
   */
  async changePropertyStatus(
    id: number,
    status: PropertyStatus,
    userId: number,
    isAdmin: boolean = false,
  ): Promise<Property> {
    // First check if property exists and user has access
    const property = await this.propertyRepo.getPropertyById(id);

    if (!isAdmin && property.userId !== userId) {
      throw new UnauthorizedError(
        "You do not have permission to update this property",
      );
    }

    return this.propertyRepo.updateProperty(id, { status });
  }

  /**
   * Delete a property with authorization check
   */
  async deleteProperty(
    id: number,
    userId: number,
    isAdmin: boolean = false,
  ): Promise<Property> {
    // First check if property exists and user has access
    const property = await this.propertyRepo.getPropertyById(id);

    if (!isAdmin && property.userId !== userId) {
      throw new UnauthorizedError(
        "You do not have permission to delete this property",
      );
    }

    return this.propertyRepo.deleteProperty(id);
  }

  /**
   * Get property statistics for a user
   */
  async getUserPropertyStats(userId: number): Promise<UserPropertyStats> {
    return this.propertyRepo.getUserPropertyStats(userId);
  }
}
