import { PropertyStatus } from "@prisma/client";

// Base property schema with common properties
const propertyBaseSchema = {
  type: "object",
  properties: {
    address: { type: "string" },
    city: { type: "string" },
    state: { type: "string" },
    country: { type: "string" },
    postalCode: { type: "string" },
    description: { type: "string" },
    propertyType: { type: "string" },
    bedrooms: { type: "integer", minimum: 0 },
    bathrooms: { type: "number", minimum: 0 },
    squareFootage: { type: "number", minimum: 0 },
    yearBuilt: { type: "integer" },
    status: {
      type: "string",
      enum: Object.values(PropertyStatus),
    },
    amenities: {
      type: "array",
      items: { type: "string" },
    },
  },
};

// Schema for creating a new property
export const createPropertySchema = {
  ...propertyBaseSchema,
  required: ["address", "city", "country", "status"],
  additionalProperties: false,
};

// Schema for updating an existing property
export const updatePropertySchema = {
  ...propertyBaseSchema,
  additionalProperties: false,
};

// Schema for a single property response
export const propertyResponseSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    ...propertyBaseSchema.properties,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    ownerId: { type: "integer" },
    owner: {
      type: "object",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        email: { type: "string" },
      },
    },
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          url: { type: "string" },
          caption: { type: "string" },
        },
      },
    },
  },
};

// Schema for multiple properties response
export const propertiesResponseSchema = {
  type: "object",
  properties: {
    properties: {
      type: "array",
      items: propertyResponseSchema,
    },
    pagination: {
      type: "object",
      properties: {
        total: { type: "integer" },
        page: { type: "integer" },
        limit: { type: "integer" },
        pages: { type: "integer" },
      },
    },
  },
};

// Make sure these exports match what you're requiring in your properties.ts
module.exports = {
  createPropertySchema,
  updatePropertySchema,
  propertyResponseSchema,
  propertiesResponseSchema,
};
