import {
  PrismaClient,
  Incident,
  IncidentStatus,
  IncidentSeverity,
  Prisma,
} from "@prisma/client";
import {
  IncidentRepository,
  IncidentQueryParams,
  PaginatedResponse,
  IncidentWithRelations,
  IncidentWithFullRelations,
  IncidentStats,
} from "../../repositories/incidentRepository";
import { NotFoundError } from "../../utils/errors";

// Define incident create/update input types with specific types
export interface CreateIncidentInput {
  propertyId: number;
  incidentType: string;
  description: string;
  reportedAt?: Date | string;
  severity: IncidentSeverity;
  status?: IncidentStatus;
  images?: {
    imageUrl: string;
    caption?: string;
    takenAt?: Date | string;
  }[];
}

export interface UpdateIncidentInput {
  incidentType?: string;
  description?: string;
  reportedAt?: Date | string;
  resolvedAt?: Date | string | null;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  images?: {
    id?: number;
    imageUrl: string;
    caption?: string;
    takenAt?: Date | string;
  }[];
}

/**
 * Service for incident-related business logic
 */
export class IncidentService {
  private incidentRepo: IncidentRepository;

  constructor(prisma: PrismaClient) {
    this.incidentRepo = new IncidentRepository(prisma);
  }

  /**
   * Get incidents with pagination and filtering
   */
  async getIncidents(
    queryParams: IncidentQueryParams,
  ): Promise<PaginatedResponse<IncidentWithRelations>> {
    return this.incidentRepo.getIncidents(queryParams);
  }

  /**
   * Get an incident by ID
   */
  async getIncidentById(id: number): Promise<IncidentWithFullRelations> {
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    return incident;
  }

  /**
   * Create a new incident
   */
  async createIncident(data: CreateIncidentInput): Promise<Incident> {
    // Business logic validations can go here
    const { images, ...incidentData } = data;

    const finalData = {
      ...incidentData,
      status: data.status || IncidentStatus.Open,
      reportedAt: data.reportedAt ? new Date(data.reportedAt) : new Date(),
      resolvedAt: null, // Adding the required resolvedAt field as null for new incidents
    };

    // Using the standard createIncident method
    const incident = await this.incidentRepo.createIncident(finalData);

    // Add images if provided
    if (images && images.length > 0) {
      await this.incidentRepo.addIncidentImages(
        incident.id,
        images.map((img) => ({
          ...img,
          takenAt: img.takenAt ? new Date(img.takenAt) : new Date(),
        })),
      );
    }

    return this.getIncidentById(incident.id);
  }

  /**
   * Update an incident
   */
  async updateIncident(
    id: number,
    data: UpdateIncidentInput,
  ): Promise<Incident> {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    // Handle dates
    const parsedData = {
      ...data,
      reportedAt: data.reportedAt ? new Date(data.reportedAt) : undefined,
      resolvedAt:
        data.resolvedAt === null
          ? null
          : data.resolvedAt
            ? new Date(data.resolvedAt)
            : undefined,
    };

    // Handle image updates separately if provided
    const { images, ...incidentData } = parsedData;

    // Update the incident
    await this.incidentRepo.updateIncidentStatus(
      id,
      incidentData.status || incident.status,
      incidentData.resolvedAt,
    );

    // If there are any images to add
    if (images && images.length > 0) {
      await this.incidentRepo.addIncidentImages(
        id,
        images
          .filter((img) => !img.id)
          .map((img) => ({
            imageUrl: img.imageUrl,
            caption: img.caption,
            takenAt: img.takenAt ? new Date(img.takenAt) : new Date(),
          })),
      );

      // Note: The current repository doesn't support updating existing images
      // If that functionality is needed, it would need to be added to the repository
    }

    return this.getIncidentById(id);
  }

  /**
   * Change incident status
   */
  async changeIncidentStatus(
    id: number,
    status: IncidentStatus,
    resolvedAt?: Date | string | null,
  ): Promise<Incident> {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    // Parse date if provided
    const parsedResolvedAt = resolvedAt
      ? resolvedAt === null
        ? null
        : new Date(resolvedAt)
      : status === IncidentStatus.Resolved || status === IncidentStatus.Closed
        ? new Date()
        : null;

    return this.incidentRepo.updateIncidentStatus(id, status, parsedResolvedAt);
  }

  /**
   * Delete an incident
   */
  async deleteIncident(id: number): Promise<{ success: boolean; id: number }> {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    return this.incidentRepo.deleteIncident(id);
  }

  /**
   * Get incident statistics
   */
  async getIncidentStats(propertyId?: number): Promise<IncidentStats> {
    return this.incidentRepo.getIncidentStats(propertyId);
  }

  /**
   * Add images to an incident
   */
  async addIncidentImages(
    id: number,
    images: {
      imageUrl: string;
      caption?: string;
      takenAt?: Date | string;
    }[],
  ) {
    // First check if incident exists
    const incident = await this.incidentRepo.getIncidentById(id);

    if (!incident) {
      throw new NotFoundError(`Incident with ID ${id} not found`);
    }

    return this.incidentRepo.addIncidentImages(
      id,
      images.map((img) => ({
        ...img,
        takenAt: img.takenAt ? new Date(img.takenAt) : new Date(),
      })),
    );
  }
}
