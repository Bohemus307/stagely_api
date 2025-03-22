import { SpaceType } from "@prisma/client";

// Base property space schema
const baseSpaceSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    propertyId: { type: "integer" },
    name: { type: ["string", "null"] },
    type: { type: "string", enum: Object.values(SpaceType) },
    aiGenerated: { type: "boolean" },
    featureVector: { type: ["object", "null"] },
    confidenceScore: { type: ["number", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Schema for creating a space
const createSpaceSchema = {
  type: "object",
  properties: {
    propertyId: { type: "integer" },
    name: { type: ["string", "null"] },
    type: { type: "string", enum: Object.values(SpaceType) },
    aiGenerated: { type: "boolean" },
    featureVector: { type: ["object", "null"] },
    confidenceScore: { type: ["number", "null"] },
  },
  required: ["propertyId"],
};

// Schema for updating a space
const updateSpaceSchema = {
  type: "object",
  properties: {
    name: { type: ["string", "null"] },
    type: { type: "string", enum: Object.values(SpaceType) },
    aiGenerated: { type: "boolean" },
    featureVector: { type: ["object", "null"] },
    confidenceScore: { type: ["number", "null"] },
  },
  minProperties: 1,
};

// Property image schema
const propertyImageSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    inspectionId: { type: "integer" },
    spaceId: { type: ["integer", "null"] },
    imageUrl: { type: "string" },
    caption: { type: ["string", "null"] },
    takenAt: { type: "string", format: "date-time" },
    metadata: { type: ["object", "null"] },
    featureVector: { type: ["object", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Property basic info schema
const propertyBasicSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    address: { type: "string" },
    city: { type: "string" },
    state: { type: ["string", "null"] },
    zipCode: { type: ["string", "null"] },
    country: { type: "string" },
    status: { type: "string" },
  },
};

// Schema for full space response with relationships
const spaceResponseSchema = {
  type: "object",
  properties: {
    ...baseSpaceSchema.properties,
    images: {
      type: "array",
      items: propertyImageSchema,
    },
    property: propertyBasicSchema,
  },
};

// Schema for space list response
const spacesListResponseSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      ...baseSpaceSchema.properties,
      images: {
        type: "array",
        items: propertyImageSchema,
      },
    },
  },
};

// Schema for paginated spaces response
const spacesResponseSchema = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...baseSpaceSchema.properties,
          images: {
            type: "array",
            items: propertyImageSchema,
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

// Schema for classification result
const classificationResponseSchema = {
  type: "object",
  properties: {
    spaceId: { type: "integer" },
    spaceType: { type: "string", enum: Object.values(SpaceType) },
    confidenceScore: { type: "number" },
    featureVector: { type: "object" },
  },
};

// Schema for multiple classification results
const multipleClassificationResponseSchema = {
  type: "array",
  items: classificationResponseSchema,
};

const propertySpaceSchemas = {
  baseSpaceSchema,
  createSpaceSchema,
  updateSpaceSchema,
  spaceResponseSchema,
  spacesListResponseSchema,
  spacesResponseSchema,
  classificationResponseSchema,
  multipleClassificationResponseSchema,
};

export default propertySpaceSchemas;
