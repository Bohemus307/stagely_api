import { IncidentSeverity, IncidentStatus } from "@prisma/client";

// Base incident schema with common properties
const incidentBaseSchema = {
  type: "object",
  properties: {
    incidentType: { type: "string" },
    description: { type: "string" },
    reportedAt: { type: "string", format: "date-time" },
    resolvedAt: { type: "string", format: "date-time", nullable: true },
    severity: {
      type: "string",
      enum: Object.values(IncidentSeverity),
    },
    status: {
      type: "string",
      enum: Object.values(IncidentStatus),
      default: "Open",
    },
  },
};

// Schema for creating a new incident
export const createIncidentSchema = {
  type: "object",
  properties: {
    ...incidentBaseSchema.properties,
    propertyId: { type: "integer" },
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          imageUrl: { type: "string" },
          caption: { type: "string", nullable: true },
          takenAt: { type: "string", format: "date-time", nullable: true },
        },
        required: ["imageUrl"],
      },
    },
  },
  required: ["propertyId", "incidentType", "description", "severity"],
  additionalProperties: false,
};

// Schema for updating an existing incident
export const updateIncidentSchema = {
  type: "object",
  properties: {
    ...incidentBaseSchema.properties,
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          imageUrl: { type: "string" },
          caption: { type: "string", nullable: true },
          takenAt: { type: "string", format: "date-time", nullable: true },
        },
        required: ["imageUrl"],
      },
    },
  },
  additionalProperties: false,
};

// Schema for changing incident status
export const updateIncidentStatusSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: Object.values(IncidentStatus),
      description: "New incident status",
    },
    resolvedAt: {
      type: "string",
      format: "date-time",
      nullable: true,
      description: "Resolution date (required if status is Resolved or Closed)",
    },
  },
  required: ["status"],
  additionalProperties: false,
};

// Schema for adding images to an incident
export const addIncidentImagesSchema = {
  type: "object",
  properties: {
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          imageUrl: { type: "string" },
          caption: { type: "string", nullable: true },
          takenAt: { type: "string", format: "date-time", nullable: true },
        },
        required: ["imageUrl"],
      },
    },
  },
  required: ["images"],
  additionalProperties: false,
};

// Schema for incident image
const incidentImageSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    incidentId: { type: "integer" },
    imageUrl: { type: "string" },
    caption: { type: "string", nullable: true },
    takenAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Schema for a single incident response
export const incidentResponseSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    propertyId: { type: "integer" },
    ...incidentBaseSchema.properties,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    property: {
      type: "object",
      properties: {
        id: { type: "integer" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string", nullable: true },
        zipCode: { type: "string", nullable: true },
        country: { type: "string" },
        status: {
          type: "string",
          enum: Object.values(IncidentStatus),
        },
      },
    },
    images: {
      type: "array",
      items: incidentImageSchema,
    },
  },
};

// Schema for multiple incidents response
export const incidentsResponseSchema = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          propertyId: { type: "integer" },
          ...incidentBaseSchema.properties,
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          property: {
            type: "object",
            properties: {
              id: { type: "integer" },
              address: { type: "string" },
              city: { type: "string" },
              state: { type: "string", nullable: true },
              country: { type: "string" },
            },
          },
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                imageUrl: { type: "string" },
                caption: { type: "string", nullable: true },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    meta: {
      type: "object",
      properties: {
        page: { type: "integer" },
        limit: { type: "integer" },
        total: { type: "integer" },
        totalPages: { type: "integer" },
      },
    },
  },
};

// Schema for incident statistics response
export const incidentStatsResponseSchema = {
  type: "object",
  properties: {
    byStatus: {
      type: "array",
      items: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: Object.values(IncidentStatus),
          },
          _count: { type: "integer" },
        },
      },
    },
    bySeverity: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: Object.values(IncidentSeverity),
          },
          _count: { type: "integer" },
        },
      },
    },
    topIncidentTypes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          incidentType: { type: "string" },
          _count: { type: "integer" },
        },
      },
    },
    avgResolutionTime: { type: "number" },
  },
};

// Export schemas
export default {
  createIncidentSchema,
  updateIncidentSchema,
  updateIncidentStatusSchema,
  addIncidentImagesSchema,
  incidentResponseSchema,
  incidentsResponseSchema,
  incidentStatsResponseSchema,
};
