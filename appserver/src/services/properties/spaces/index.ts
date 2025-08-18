import {
  PrismaClient,
  PropertySpace,
  SpaceType,
  Prisma,
  PropertyImage,
} from "@prisma/client";
import {
  PropertySpaceRepository,
  PropertySpaceQueryParams,
  PropertySpaceWithFullRelations,
  SpaceClassificationResult,
} from "../../../repositories/propertySpacesRepository";
import { NotFoundError, ConflictError } from "../../../utils/errors";
import { SpaceClassificationService } from "./classification";
import { S3Client } from "@aws-sdk/client-s3";

/**
 * Service for handling property space operations
 */
export class PropertySpaceService {
  private repository: PropertySpaceRepository;
  private s3: { client: S3Client; bucket: string; region: string };

  constructor(
    prisma: PrismaClient,
    s3: { client: S3Client; bucket: string; region: string },
  ) {
    this.repository = new PropertySpaceRepository(prisma, s3);
    this.s3 = s3;
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
    data: Prisma.PropertySpaceUpdateInput & {
      objectLabels?: Array<{
        name: string;
        confidence: number;
        category?: string;
      }>;
    },
  ): Promise<PropertySpace> {
    // Check if space exists
    await this.repository.getSpaceById(id).catch(() => {
      throw new NotFoundError("Property space not found");
    });

    // Extract objectLabels from data
    const { objectLabels, ...spaceUpdateData } = data;

    // Update the space
    const updatedSpace = await this.repository.updateSpace(id, spaceUpdateData);

    // If objectLabels are provided, update them
    if (objectLabels && Array.isArray(objectLabels)) {
      // Clear existing labels and add new ones
      await this.repository.updateSpaceObjectLabels(id, objectLabels);
    }

    // Return the fully updated space with labels
    return await this.repository.getSpaceById(id);
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
   * Automatically create spaces and classify images using AI
   * Also saves object labels detected in the images
   */
  async autoCreateAndClassifySpaces(
    propertyId: number,
    imageIds: number[],
  ): Promise<SpaceClassificationResult[]> {
    // Validate property exists and get images (concurrent)
    const [propertyExists, images] = await Promise.all([
      this.repository.propertyExists(propertyId),
      this.repository.getImagesByIds(imageIds),
    ]);

    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    // If no images, return empty result
    if (images.length === 0) {
      return [];
    }

    // Create the classification service
    const classificationService = new SpaceClassificationService(this.s3);

    // Get all image URLs
    const imageUrls = images.map((img) => img.imageUrl);

    // Process ALL images at once using our optimized service
    // The service internally handles controlled concurrency
    const results =
      await classificationService.classifyMultipleImages(imageUrls);

    // Group images by AI-determined space type
    const imagesByType = await this.groupImagesBySpaceType(images);

    // Create spaces for each type concurrently
    const createSpacePromises = Object.entries(imagesByType).map(
      async ([spaceType, groupImages]) => {
        // Skip if no images for this type
        if (groupImages.length === 0) return null;

        try {
          // Extract object labels from the classification results
          const objectLabels = this.extractObjectLabels(results);

          // Create a space for this type
          const spaceName = `${spaceType} ${new Date().toISOString().slice(0, 10)}`;
          const newSpace = await this.repository.createSpace({
            propertyId,
            name: spaceName,
            type: spaceType as SpaceType,
            confidenceScore: new Prisma.Decimal(
              Number(results.confidenceScore).toFixed(4),
            ),
            featureVector: results.featureVector as Prisma.InputJsonValue,
            aiGenerated: true,
          });

          // Save the object labels if we have any
          if (objectLabels.length > 0) {
            await this.repository.addObjectLabelsToSpace(
              newSpace.id,
              objectLabels,
            );
          }

          // Get IDs of images in this group
          const groupImageIds = groupImages.map((img) => img.id);

          // Associate images with the new space
          await this.repository.associateImagesWithSpace(
            newSpace.id,
            groupImageIds,
          );

          // Create the result (with optional objectLabels field)
          const result: SpaceClassificationResult = {
            spaceId: newSpace.id,
            spaceType: spaceType as SpaceType,
            confidenceScore: new Prisma.Decimal(
              Number(results.confidenceScore).toFixed(4),
            ),
            featureVector: results.featureVector,
          };

          // Add object labels if we have any
          if (objectLabels.length > 0) {
            result.objectLabels = objectLabels.map((label) => label.name);
          }

          return result;
        } catch (error) {
          console.error(`Error processing space type ${spaceType}:`, error);
          return null;
        }
      },
    );

    // Wait for all space processing to complete and filter out null results
    const spaceResults = await Promise.all(createSpacePromises);

    // Fix the type predicate to match SpaceClassificationResult
    return spaceResults.filter(
      (result): result is SpaceClassificationResult => result !== null,
    );
  }

  /**
   * Extract object labels from classification result
   */
  private extractObjectLabels(
    classificationResult: any,
  ): Array<{ name: string; confidence: number; category?: string }> {
    const objectLabels: Array<{
      name: string;
      confidence: number;
      category?: string;
    }> = [];

    // Extract detected objects from the feature vector
    const featureVector = classificationResult.featureVector as any;

    if (
      featureVector?.detectedObjects &&
      Array.isArray(featureVector.detectedObjects)
    ) {
      featureVector.detectedObjects.forEach((objectName: string) => {
        objectLabels.push({
          name: objectName,
          confidence: 0.9, // High confidence for detected objects
          category: this.categorizeObject(objectName),
        });
      });
    }

    // Add labels if they aren't already included as objects
    if (
      classificationResult.labels &&
      Array.isArray(classificationResult.labels)
    ) {
      classificationResult.labels.forEach((label: string) => {
        // Don't add duplicates
        if (
          !objectLabels.some(
            (obj) => obj.name.toLowerCase() === label.toLowerCase(),
          )
        ) {
          objectLabels.push({
            name: label,
            confidence: 0.75, // Lower confidence for general labels
            category: this.categorizeObject(label),
          });
        }
      });
    }

    return objectLabels;
  }

  /**
   * Categorize an object based on its name
   */
  private categorizeObject(objectName: string): string | undefined {
    // Define categories and their objects
    const categories: Record<string, string[]> = {
      Furniture: [
        "Sofa",
        "Chair",
        "Table",
        "Bed",
        "Dresser",
        "Nightstand",
        "Couch",
        "Desk",
        "Bench",
        "Ottoman",
        "Stool",
        "Bookcase",
        "Shelf",
      ],
      Appliances: [
        "Refrigerator",
        "Oven",
        "Microwave",
        "Dishwasher",
        "Washing Machine",
        "Dryer",
        "Stove",
        "Range",
        "Toaster",
        "Blender",
        "Coffee Maker",
      ],
      Fixtures: [
        "Sink",
        "Toilet",
        "Bathtub",
        "Shower",
        "Light",
        "Lamp",
        "Faucet",
        "Mirror",
        "Ceiling Fan",
        "Chandelier",
      ],
      Electronics: [
        "Television",
        "TV",
        "Computer",
        "Laptop",
        "Monitor",
        "Speaker",
        "Stereo",
        "Phone",
        "Camera",
      ],
      Storage: [
        "Cabinet",
        "Shelf",
        "Wardrobe",
        "Closet",
        "Drawer",
        "Chest",
        "Trunk",
        "Box",
        "Container",
        "Basket",
      ],
      Architectural: [
        "Wall",
        "Floor",
        "Ceiling",
        "Window",
        "Door",
        "Stairs",
        "Railing",
        "Porch",
        "Deck",
        "Patio",
        "Balcony",
      ],
    };

    // Convert object name to lowercase for case-insensitive matching
    const name = objectName.toLowerCase();

    // Check each category
    for (const [category, objects] of Object.entries(categories)) {
      if (
        objects.some(
          (obj) =>
            name.includes(obj.toLowerCase()) ||
            obj.toLowerCase().includes(name),
        )
      ) {
        return category;
      }
    }

    return undefined;
  }

  /**
   * Group images by their likely space types using preliminary classification
   */
  private async groupImagesBySpaceType(
    images: PropertyImage[],
  ): Promise<Record<SpaceType, PropertyImage[]>> {
    // Initialize result with empty arrays for each space type
    const result: Record<SpaceType, PropertyImage[]> = {} as any;
    Object.values(SpaceType).forEach((type) => {
      result[type] = [];
    });
    // Create classification service
    const classificationService = new SpaceClassificationService(this.s3);

    // Classify each image individually
    for (const image of images) {
      try {
        const classification = await classificationService.classifyImage(
          image.imageUrl,
        );
        result[classification.spaceType].push(image);
      } catch (error) {
        console.error(`Error classifying image ${image.id}:`, error);
        // Add to Unknown category if classification fails
        result[SpaceType.Unknown].push(image);
      }
    }

    return result;
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

  /**
   * Bulk upload images to an space
   */
  async bulkUploadSpaceImages(
    spaceId: number,
    images: {
      imageUrl: string;
      caption?: string | null;
      takenAt: Date;
      metadata?: any | null;
    }[],
  ): Promise<PropertyImage[]> {
    // First check if inspection exists
    const space = await this.repository.getSpaceById(spaceId);

    if (!space) {
      throw new NotFoundError(`Space with ID ${spaceId} not found`);
    }

    // Process each image one by one
    const uploadedImages: PropertyImage[] = [];

    for (const image of images) {
      const uploadedImage = await this.repository.uploadPropertySpaceImage({
        spaceId,
        imageUrl: image.imageUrl,
        caption: image.caption,
        takenAt: image.takenAt,
        metadata: image.metadata,
      });

      uploadedImages.push(uploadedImage);
    }

    return uploadedImages;
  }

  /**
   * Create a space from an image URL by:
   * 1. Creating a temporary space
   * 2. Uploading the image to this space
   * 3. Classifying the image
   * 4. Creating the proper space based on classification
   */
  async createSpaceFromImage(
    propertyId: number,
    imageUrl: string,
    metadata?: any,
  ): Promise<PropertySpaceWithFullRelations> {
    // Check if property exists
    const propertyExists = await this.repository.propertyExists(propertyId);
    if (!propertyExists) {
      throw new NotFoundError("Property not found");
    }

    // Create a temporary space to associate with the image
    const tempSpace = await this.repository.createSpace({
      propertyId,
      name: `Temp ${new Date().toISOString()}`,
      type: SpaceType.Unknown,
      aiGenerated: true,
    });

    try {
      // Upload the image using the existing bulkUploadSpaceImages method
      const currentDate = new Date();
      const uploadedImages = await this.bulkUploadSpaceImages(tempSpace.id, [
        {
          imageUrl,
          takenAt: currentDate,
          metadata,
        },
      ]);

      if (uploadedImages.length === 0) {
        throw new ConflictError("Failed to upload image");
      }

      const propertyImage = uploadedImages[0];

      // Now classify the image and create a properly classified space
      const classificationResults = await this.autoCreateAndClassifySpaces(
        propertyId,
        [propertyImage.id],
      );

      // Delete the temporary space as we now have a properly classified one
      await this.deleteSpace(tempSpace.id);

      // If classification failed, throw an error
      if (classificationResults.length === 0) {
        throw new ConflictError("Failed to classify and create space");
      }

      // Get the created space ID and return the full space details
      const spaceId = classificationResults[0].spaceId;
      if (!spaceId) {
        throw new ConflictError("No Space Created");
      }

      return await this.getSpaceById(spaceId);
    } catch (error) {
      // Clean up the temporary space if anything fails
      await this.deleteSpace(tempSpace.id).catch(() => {
        // Ignore errors during cleanup
      });
      throw error;
    }
  }
}
