import { PropertyStatus, SpaceType } from "@prisma/client";

// Base property schema with common properties
const propertyBaseSchema = {
  type: "object",
  properties: {
    address: { type: "string" },
    city: { type: "string" },
    state: { type: "string" },
    zipCode: { type: "string" },
    country: { type: "string" },
    latitude: { type: "number", format: "float" },
    longitude: { type: "number", format: "float" },
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
    name: { type: "string" },
    type: {
      type: "string",
      enum: Object.values(SpaceType),
    },
    aiGenerated: { type: "boolean" },
    confidenceScore: { type: "number", format: "float" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          imageUrl: { type: "string" },
          caption: { type: "string" },
          takenAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};

// Schema for inspection
const inspectionSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    title: { type: "string" },
    description: { type: "string" },
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
          caption: { type: "string" },
          takenAt: { type: "string", format: "date-time" },
          spaceId: { type: "integer" },
        },
      },
    },
  },
};

// Schema for a single property response
export const propertyResponseSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    ...propertyBaseSchema.properties,
    incidentCount: { type: "integer" },
    openIncidentCount: { type: "integer" },
    lastIncidentAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    userId: { type: "integer" },
    user: {
      type: "object",
      properties: {
        id: { type: "integer" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        profilePictureUrl: { type: "string" },
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
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          incidentType: { type: "string" },
          description: { type: "string" },
          reportedAt: { type: "string", format: "date-time" },
          resolvedAt: { type: "string", format: "date-time" },
          severity: { type: "string" },
          status: { type: "string" },
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                imageUrl: { type: "string" },
                caption: { type: "string" },
              },
            },
          },
        },
      },
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
          incidentCount: { type: "integer" },
          openIncidentCount: { type: "integer" },
          lastIncidentAt: { type: "string", format: "date-time" },
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

// Make sure these exports match what you're requiring in your properties.ts
export default {
  createPropertySchema,
  updatePropertySchema,
  propertyResponseSchema,
  propertiesResponseSchema,
};
