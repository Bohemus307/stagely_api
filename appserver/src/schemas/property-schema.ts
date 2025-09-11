import {
  PropertyStatus,
  SpaceType,
  IncidentSeverity,
  IncidentStatus,
} from "@prisma/client";

// Base property schema with common properties
const propertyBaseSchema = {
  type: "object",
  properties: {
    address: { type: "string" },
    city: { type: "string" },
    state: { type: "string", nullable: true },
    zipCode: { type: "string", nullable: true },
    country: { type: "string" },
    latitude: { type: "number" },
    longitude: { type: "number" },
    imageUrl: { type: "string", nullable: true },
    status: {
      type: "string",
      enum: Object.values(PropertyStatus),
    },
  },
};

// Schema for creating a new property
export const createPropertySchema = {
  ...propertyBaseSchema,
  required: ["address", "city", "country", "latitude", "longitude", "status"],
  additionalProperties: false,
};

// Schema for updating an existing property
export const updatePropertySchema = {
  ...propertyBaseSchema,
  additionalProperties: false,
};

// Schema for property space
const propertySpaceSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    propertyId: { type: "integer" },
    name: { type: "string", nullable: true },
    type: {
      type: "string",
      enum: Object.values(SpaceType),
      default: "Unknown",
    },
    aiGenerated: { type: "boolean", default: true },
    featureVector: { type: "object", nullable: true },
    confidenceScore: { type: "number", nullable: true }, // Removed format: "decimal"
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
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
          featureVector: { type: "object", nullable: true },
        },
      },
    },
  },
};

// Schema for image similarity
const imageSimilaritySchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    baseImageId: { type: "integer" },
    comparedImageId: { type: "integer" },
    similarityScore: { type: "number" }, // Removed format: "decimal"
    createdAt: { type: "string", format: "date-time" },
  },
};

// Schema for image change
const imageChangeSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    imageId: { type: "integer" },
    changeType: { type: "string" },
    description: { type: "string", nullable: true },
    boundingBox: { type: "object", nullable: true },
    confidenceScore: { type: "number" },
    verified: { type: "boolean", default: false },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Schema for inspection
const inspectionSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    propertyId: { type: "integer" },
    title: { type: "string", default: "Inspection" },
    description: { type: "string", nullable: true },
    inspectionDate: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    photos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          imageUrl: { type: "string" },
          caption: { type: "string", nullable: true },
          takenAt: { type: "string", format: "date-time" },
          spaceId: { type: "integer", nullable: true },
          metadata: { type: "object", nullable: true },
          featureVector: { type: "object", nullable: true },
        },
      },
    },
  },
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

// Schema for incident
const incidentSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    propertyId: { type: "integer" },
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
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    images: {
      type: "array",
      items: incidentImageSchema,
    },
  },
};

// Schema for a single property response
export const propertyResponseSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    ...propertyBaseSchema.properties,
    incidentCount: { type: "integer", default: 0 },
    openIncidentCount: { type: "integer", default: 0 },
    lastIncidentAt: { type: "string", format: "date-time", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    userId: { type: "integer" },
    user: {
      type: "object",
      properties: {
        id: { type: "integer" },
        auth0Id: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string", nullable: true },
        profilePictureUrl: { type: "string", nullable: true },
        lastLogin: { type: "string", format: "date-time", nullable: true },
      },
    },
    spaces: {
      type: "array",
      items: propertySpaceSchema,
    },
    inspections: {
      type: "array",
      items: inspectionSchema,
    },
    incidents: {
      type: "array",
      items: incidentSchema,
    },
  },
};

// Schema for multiple properties response
export const propertiesResponseSchema = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          ...propertyBaseSchema.properties,
          incidentCount: { type: "integer", default: 0 },
          openIncidentCount: { type: "integer", default: 0 },
          lastIncidentAt: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          userId: { type: "integer" },
          user: {
            type: "object",
            properties: {
              id: { type: "integer" },
              firstName: { type: "string" },
              lastName: { type: "string" },
            },
          },
          spaces: {
            type: "array",
            items: propertySpaceSchema,
          },
          _count: {
            type: "object",
            properties: {
              incidents: { type: "integer" },
              inspections: { type: "integer" },
              spaces: { type: "integer" },
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

// Export schemas
export default {
  createPropertySchema,
  updatePropertySchema,
  propertyResponseSchema,
  propertiesResponseSchema,
  inspectionSchema,
  propertySpaceSchema,
  incidentSchema,
  imageChangeSchema,
  imageSimilaritySchema,
};
