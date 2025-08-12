import {
  Inspection,
  PropertyImage,
} from "@prisma/client";
import { PaginatedResponse } from "../../../repositories/incidentRepository";
import {
  InspectionRepository,
  InspectionQueryParams,
  InspectionWithImages,
  InspectionWithFullDetails,
  CreateInspectionParams,
  UploadInspectionImageParams,
} from "../../../repositories/inspectionRepository";
import { NotFoundError } from "../../../utils/errors";
import { EventMetadata } from "../../../repositories/dynamoDB/eventsRepository";

// Define inspection create/update input types with specific types
export interface CreateInspectionInput {
  propertyId: number;
  title?: string;
  description?: string | null;
  inspectionDate: Date;
}

export interface UpdateInspectionInput {
  title?: string;
  description?: string | null;
  inspectionDate?: Date;
  status?: string;
  completed?: boolean;

}

export interface UploadImageInput {
  inspectionId: number;
  imageUrl: string;
  caption?: string | null;
  takenAt: Date;
  spaceId?: number | null;
  spaceType?: string | null;
  metadata?: any | null;
}

export interface ClassifyImagesInput {
  imageIds: number[];
  spaceId: number;
}

/**
 * Service for inspection-related business logic
 */
export class InspectionService {
  private inspectionRepo: InspectionRepository;

  constructor(inspectionRepository: InspectionRepository) {
  this.inspectionRepo = inspectionRepository;
}

  /**
   * Get inspections with pagination and filtering
   */
  async getInspections(
    queryParams: InspectionQueryParams,
  ): Promise<PaginatedResponse<InspectionWithImages>> {
    return this.inspectionRepo.getInspections(queryParams);
  }

  /**
   * Get an inspection by ID
   */
  async getInspectionById(
    id: number,
    userId?: number,
    metadata?: EventMetadata
  ): Promise<InspectionWithFullDetails> {
    const inspection = await this.inspectionRepo.getInspectionById(id, userId, metadata);

    if (!inspection) {
      throw new NotFoundError(`Inspection with ID ${id} not found`);
    }

    return inspection;
  }

  /**
   * Create a new inspection
   */
  async createInspection(
    data: CreateInspectionInput,
    userId?: number,
    requestUserId?: number,
    metadata?: EventMetadata
  ): Promise<Inspection> {
    // Business logic validations can go here
    const finalData: CreateInspectionParams = {
      propertyId: data.propertyId,
      title: data.title || "Inspection",
      description: data.description,
      inspectionDate: data.inspectionDate,
    };

    return this.inspectionRepo.createInspection(finalData, userId, requestUserId, metadata);
  }

  /**
   * Update an inspection
   */
  async updateInspection(
    id: number,
    data: UpdateInspectionInput,
    userId?: number,
    metadata?: EventMetadata
  ): Promise<Inspection> {
    // First check if inspection exists
    const inspection = await this.inspectionRepo.getInspectionById(id);

    if (!inspection) {
      throw new NotFoundError(`Inspection with ID ${id} not found`);
    }

    return this.inspectionRepo.updateInspection(id, data, userId, metadata);
  }

  /**
   * Delete an inspection
   */
  async deleteInspection(
    id: number,
    userId?: number,
    metadata?: EventMetadata
  ): Promise<Inspection> {
    // First check if inspection exists
    const inspection = await this.inspectionRepo.getInspectionById(id);

    if (!inspection) {
      throw new NotFoundError(`Inspection with ID ${id} not found`);
    }

    return this.inspectionRepo.deleteInspection(id, userId, metadata);
  }

  /**
   * Upload an image to an inspection
   */
  async uploadInspectionImage(
    data: UploadImageInput,
    userId?: number,
    metadata?: EventMetadata
  ): Promise<PropertyImage> {
    // First check if inspection exists
    const inspection = await this.inspectionRepo.getInspectionById(
      data.inspectionId,
    );

    if (!inspection) {
      throw new NotFoundError(
        `Inspection with ID ${data.inspectionId} not found`,
      );
    }

    const imageData: UploadInspectionImageParams = {
      inspectionId: data.inspectionId,
      imageUrl: data.imageUrl,
      caption: data.caption,
      takenAt: data.takenAt,
      spaceId: data.spaceId,
      metadata: data.metadata,
    };

    return this.inspectionRepo.uploadInspectionImage(imageData, userId, metadata);
  }

  /**
   * Update an inspection image
   */
  async updateInspectionImage(
    id: number,
    data: {
      caption?: string | null;
      spaceId?: number | null;
      metadata?: any | null;
    },
  ): Promise<PropertyImage> {
    // Check if image exists
    const images = await this.inspectionRepo.getInspectionImages(id);
    if (!images || images.length === 0) {
      throw new NotFoundError(`Image with ID ${id} not found`);
    }

    return this.inspectionRepo.updateInspectionImage(id, data);
  }

  /**
   * Delete an inspection image
   */
  async deleteInspectionImage(id: number): Promise<PropertyImage> {
    // You might want to check if the image exists first
    return this.inspectionRepo.deleteInspectionImage(id);
  }

  /**
   * Get all images for an inspection
   */
  async getInspectionImages(inspectionId: number): Promise<PropertyImage[]> {
    // First check if inspection exists
    const inspection =
      await this.inspectionRepo.getInspectionById(inspectionId);

    if (!inspection) {
      throw new NotFoundError(`Inspection with ID ${inspectionId} not found`);
    }

    return this.inspectionRepo.getInspectionImages(inspectionId);
  }

  /**
   * Classify multiple images to a space
   */
  async classifyImagesToSpace(data: ClassifyImagesInput): Promise<number> {
    // You could add validation here to check if all images exist
    // and if they belong to the same property as the space
    return this.inspectionRepo.classifyImagesToSpace(
      data.imageIds,
      data.spaceId,
    );
  }

  /**
   * Get inspection statistics for a property
   */
  async getPropertyInspectionStats(propertyId: number): Promise<{
    totalInspections: number;
    totalImages: number;
    lastInspectionDate: Date | null;
    imagesByType: Record<string, number>;
  }> {
    return this.inspectionRepo.getPropertyInspectionStats(propertyId);
  }

  /**
   * Bulk upload images to an inspection
   */
  async bulkUploadImages(
    inspectionId: number,
    images: {
      imageUrl: string;
      caption?: string | null;
      takenAt: Date;
      metadata?: any | null;
    }[],
  ): Promise<PropertyImage[]> {
    // First check if inspection exists
    const inspection =
      await this.inspectionRepo.getInspectionById(inspectionId);

    if (!inspection) {
      throw new NotFoundError(`Inspection with ID ${inspectionId} not found`);
    }

    // Process each image one by one
    const uploadedImages: PropertyImage[] = [];

    for (const image of images) {
      const uploadedImage = await this.inspectionRepo.uploadInspectionImage({
        inspectionId,
        imageUrl: image.imageUrl,
        caption: image.caption,
        takenAt: image.takenAt,
        metadata: image.metadata,
      });

      uploadedImages.push(uploadedImage);
    }

    return uploadedImages;
  }
}
