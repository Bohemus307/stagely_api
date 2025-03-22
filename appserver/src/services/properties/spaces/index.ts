import { PrismaClient, PropertySpace, SpaceType, Prisma } from "@prisma/client";
import {
  PropertySpaceRepository,
  PropertySpaceQueryParams,
  PropertySpaceWithFullRelations,
  SpaceClassificationResult,
} from "../../../repositories/propertySpacesRepository";
import { NotFoundError, ConflictError } from "../../../utils/errors";

/**
 * Service for handling property space operations
 */
export class PropertySpaceService {
  private repository: PropertySpaceRepository;

  constructor(prisma: PrismaClient) {
    this.repository = new PropertySpaceRepository(prisma);
  }

  /**
   * Get property spaces with pagination, filtering and sorting
   */
  async getPropertySpaces(params: PropertySpaceQueryParams) {
    return this.repository.getPropertySpaces(params);
  }

  /**
   * Get a property space by ID
   */
  async getSpaceById(id: number): Promise<PropertySpaceWithFullRelations> {
    try {
      return await this.repository.getSpaceById(id);
    } catch (err) {
      throw new NotFoundError("Property space not found");
    }
  }

  /**
   * Get spaces by property ID
   */
  async getSpacesByPropertyId(
    propertyId: number,
    params: Omit<PropertySpaceQueryParams, "propertyId"> = {},
  ) {
    // Check if property exists
    const propertyExists = await this.repository.propertyExists(propertyId);
    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    return this.repository.getSpacesByPropertyId(propertyId, params);
  }

  /**
   * Create a new property space
   */
  async createSpace(
    data: Prisma.PropertySpaceUncheckedCreateInput,
  ): Promise<PropertySpace> {
    // Check if property exists
    const propertyExists = await this.repository.propertyExists(
      data.propertyId,
    );
    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    return this.repository.createSpace(data);
  }

  /**
   * Update a property space
   */
  async updateSpace(
    id: number,
    data: Prisma.PropertySpaceUpdateInput,
  ): Promise<PropertySpace> {
    // Check if space exists
    await this.repository.getSpaceById(id).catch(() => {
      throw new NotFoundError("Property space not found");
    });

    return this.repository.updateSpace(id, data);
  }

  /**
   * Delete a property space
   */
  async deleteSpace(id: number): Promise<PropertySpace> {
    // Check if space exists
    await this.repository.getSpaceById(id).catch(() => {
      throw new NotFoundError("Property space not found");
    });

    return this.repository.deleteSpace(id);
  }

  /**
   * Associate images with a space
   */
  async associateImagesWithSpace(
    spaceId: number,
    imageIds: number[],
  ): Promise<void> {
    // Check if space exists
    await this.repository.getSpaceById(spaceId).catch(() => {
      throw new NotFoundError("Property space not found");
    });

    // Validate that all images exist
    const validImageIds =
      await this.repository.validatePropertyImages(imageIds);
    if (validImageIds.length !== imageIds.length) {
      const invalidIds = imageIds.filter((id) => !validImageIds.includes(id));
      throw new ConflictError(
        `Some images not found: ${invalidIds.join(", ")}`,
      );
    }

    return this.repository.associateImagesWithSpace(spaceId, imageIds);
  }

  /**
   * Remove image associations from a space
   */
  async removeImagesFromSpace(
    spaceId: number,
    imageIds: number[],
  ): Promise<void> {
    // Check if space exists
    await this.repository.getSpaceById(spaceId).catch(() => {
      throw new NotFoundError("Property space not found");
    });

    return this.repository.removeImagesFromSpace(spaceId, imageIds);
  }

  /**
   * Classify a space automatically based on its images
   */
  async classifySpace(spaceId: number): Promise<SpaceClassificationResult> {
    // Get all images associated with this space
    const images = await this.repository.getSpaceImages(spaceId);
    if (images.length === 0) {
      throw new ConflictError(
        "Cannot classify space without associated images",
      );
    }

    // Perform space classification using AI
    const classification = await this.repository.classifySpaceFromImages(
      spaceId,
      images,
    );

    // Update the space with the classification results
    await this.repository.updateSpace(spaceId, {
      type: classification.spaceType,
      confidenceScore: classification.confidenceScore,
      featureVector: classification.featureVector as Prisma.InputJsonValue,
    });

    return classification;
  }

  /**
   * Get similar spaces based on feature vectors
   */
  async getSimilarSpaces(
    spaceId: number,
    limit: number = 5,
  ): Promise<PropertySpace[]> {
    // Check if space exists
    const space = await this.repository.getSpaceById(spaceId).catch(() => {
      throw new NotFoundError("Property space not found");
    });

    if (!space.featureVector) {
      throw new ConflictError(
        "Space does not have feature vector for similarity comparison",
      );
    }

    return this.repository.getSimilarSpaces(
      spaceId,
      space.featureVector as Prisma.JsonValue,
      limit,
    );
  }

  /**
   * Get spaces by type for a property
   */
  async getSpacesByType(
    propertyId: number,
    type: SpaceType,
  ): Promise<PropertySpace[]> {
    // Validate that the property exists
    const propertyExists = await this.repository.propertyExists(propertyId);
    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    return this.repository.getSpacesByType(propertyId, type);
  }

  /**
   * Reclassify all spaces for a property
   */
  async reclassifyPropertySpaces(
    propertyId: number,
  ): Promise<SpaceClassificationResult[]> {
    // Validate that the property exists
    const propertyExists = await this.repository.propertyExists(propertyId);
    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    // Get all spaces for this property
    const spaces = await this.repository.getSpacesByPropertyId(propertyId);

    const results: SpaceClassificationResult[] = [];

    // Classify each space
    for (const space of spaces) {
      try {
        const result = await this.classifySpace(space.id);
        results.push(result);
      } catch (error) {
        // Continue with other spaces even if one fails
        console.error(`Failed to classify space ${space.id}:`, error);
      }
    }

    return results;
  }
}
