import { IncidentSeverity, IncidentStatus, SpaceType } from "@prisma/client";

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
    spaceType: {
      type: "string",
      enum: Object.values(SpaceType),
      nullable: true,
    },
    aiClassified: {
      type: "boolean",
      default: false,
    },
    labeledImageUrl: {
      type: "string",
      nullable: true,
      description: "URL to the image with AI-detected bounding boxes",
    },
    featureVector: {
      type: "object",
      nullable: true,
    },
  },
};

// Schema for creating a new incident
export const createIncidentSchema = {
  type: "object",
  properties: {
    ...incidentBaseSchema.properties,
    propertyId: { type: "integer" },
    // Standard image array for manual creation
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          imageUrl: { type: "string" },
          caption: { type: "string", nullable: true },
          takenAt: { type: "string", format: "date-time" },
          metadata: { type: "object", nullable: true },
        },
        required: ["imageUrl"],
      },
    },
    // Single image for AI classification
    imageUrl: {
      type: "string",
      description: "URL to an image for automatic incident classification",
    },
    // Optional metadata for classification
    metadata: {
      type: "object",
      description: "Additional metadata for the image classification process",
      nullable: true,
    },
  },
  required: ["propertyId"],
  anyOf: [
    { required: ["imageUrl"] },
    { required: ["incidentType", "description", "severity"] },
  ],
  additionalProperties: false,
};

// Schema for the classify images endpoint
export const classifyImagesSchema = {
  type: "object",
  properties: {
    propertyId: {
      type: "integer",
      description: "ID of the property to create incidents for",
    },
    imageIds: {
      type: "array",
      items: { type: "integer" },
      description: "Array of image IDs to classify and create incidents from",
    },
  },
  required: ["propertyId", "imageIds"],
  additionalProperties: false,
};

// Schema for the classify images response
export const classifyImagesResponseSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      incidentId: { type: "integer" },
      spaceType: {
        type: "string",
        enum: Object.values(SpaceType),
      },
      confidenceScore: { type: "number" },
      objectLabels: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
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
          takenAt: { type: "string", format: "date-time" },
          metadata: { type: "object", nullable: true },
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
          takenAt: { type: "string", format: "date-time" },
          metadata: { type: "object", nullable: true },
        },
        required: ["imageUrl"],
      },
    },
  },
  required: ["images"],
  additionalProperties: false,
};

// Schema for incident image (using PropertyImage model from Prisma)
const incidentImageSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    incidentId: { type: "integer" },
    imageUrl: { type: "string" },
    caption: { type: "string", nullable: true },
    takenAt: { type: "string", format: "date-time" },
    metadata: { type: "object", nullable: true },
    featureVector: { type: "object", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Schema for incident object label
const incidentObjectLabelSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    incidentId: { type: "integer" },
    name: { type: "string" },
    confidence: { type: "number" },
    category: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
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
          enum: ["Active", "Maintenance", "Archived"],
        },
      },
    },
    images: {
      type: "array",
      items: incidentImageSchema,
    },
    labeledImageUrl: {
      type: "string",
      nullable: true,
      description: "URL to the image with AI-detected bounding boxes",
    },
    objectLabels: {
      type: "array",
      items: incidentObjectLabelSchema,
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
              zipCode: { type: "string", nullable: true },
              country: { type: "string" },
              status: {
                type: "string",
                enum: ["Active", "Maintenance", "Archived"],
              },
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
                takenAt: { type: "string", format: "date-time" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
          objectLabels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                confidence: { type: "number" },
                category: { type: "string", nullable: true },
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
    bySpaceType: {
      type: "array",
      items: {
        type: "object",
        properties: {
          spaceType: {
            type: "string",
            enum: Object.values(SpaceType),
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
  classifyImagesSchema,
  classifyImagesResponseSchema,
};
