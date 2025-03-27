import { PropertyStatus, SpaceType } from "@prisma/client";

// Base image schema
const imageBaseSchema = {
  type: "object",
  properties: {
    imageUrl: { type: "string" },
    caption: { type: "string", nullable: true },
    takenAt: { type: "string", format: "date-time" },
    spaceId: { type: "integer", nullable: true },
    metadata: { type: "object", nullable: true },
  },
};

// Base inspection schema with common properties
const inspectionBaseSchema = {
  type: "object",
  properties: {
    propertyId: { type: "integer" },
    title: { type: "string" },
    description: { type: "string", nullable: true },
    inspectionDate: { type: "string", format: "date-time" },
  },
};

// Schema for creating a new inspection
export const createInspectionSchema = {
  ...inspectionBaseSchema,
  required: ["propertyId", "inspectionDate"],
  additionalProperties: false,
};

// Schema for updating an existing inspection
export const updateInspectionSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string", nullable: true },
    inspectionDate: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
};

// Schema for uploading an image
export const uploadImageSchema = {
  ...imageBaseSchema,
  required: ["imageUrl", "takenAt"],
  additionalProperties: false,
};

// Schema for classifying images to a space
export const classifyImagesSchema = {
  type: "object",
  properties: {
    imageIds: {
      type: "array",
      items: { type: "integer" },
    },
    spaceId: { type: "integer" },
  },
  required: ["imageIds", "spaceId"],
  additionalProperties: false,
};

// Schema for property image with full details
const propertyImageSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    ...imageBaseSchema.properties,
    inspectionId: { type: "integer" },
    featureVector: { type: "object", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Schema for property image with space details
const propertyImageWithSpaceSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    ...imageBaseSchema.properties,
    inspectionId: { type: "integer" },
    space: {
      type: "object",
      nullable: true,
      properties: {
        id: { type: "integer" },
        name: { type: "string", nullable: true },
        type: {
          type: "string",
          enum: Object.values(SpaceType),
        },
      },
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Schema for single inspection response
export const inspectionResponseSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    ...inspectionBaseSchema.properties,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    photos: {
      type: "array",
      items: propertyImageWithSpaceSchema,
    },
    property: {
      type: "object",
      properties: {
        id: { type: "integer" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string", nullable: true },
        country: { type: "string" },
        status: {
          type: "string",
          enum: Object.values(PropertyStatus),
        },
      },
    },
  },
};

// Schema for multiple inspections response
export const inspectionsResponseSchema = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          ...inspectionBaseSchema.properties,
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          photos: {
            type: "array",
            items: propertyImageSchema,
          },
          property: {
            type: "object",
            properties: {
              id: { type: "integer" },
              address: { type: "string" },
              city: { type: "string" },
            },
          },
          _count: {
            type: "object",
            properties: {
              photos: { type: "integer" },
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

// Schema for image update
export const updateImageSchema = {
  type: "object",
  properties: {
    caption: { type: "string", nullable: true },
    spaceId: { type: "integer", nullable: true },
    metadata: { type: "object", nullable: true },
  },
  additionalProperties: false,
};

// Schema for bulk image upload
export const bulkUploadImagesSchema = {
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
        required: ["imageUrl", "takenAt"],
      },
    },
  },
  required: ["images"],
  additionalProperties: false,
};

// Schema for inspection statistics response
export const inspectionStatsSchema = {
  type: "object",
  properties: {
    totalInspections: { type: "integer" },
    totalImages: { type: "integer" },
    lastInspectionDate: { type: "string", format: "date-time", nullable: true },
    imagesByType: {
      type: "object",
      additionalProperties: { type: "integer" },
    },
  },
};

// Export schemas
export default {
  createInspectionSchema,
  updateInspectionSchema,
  uploadImageSchema,
  updateImageSchema,
  bulkUploadImagesSchema,
  classifyImagesSchema,
  inspectionResponseSchema,
  inspectionsResponseSchema,
  inspectionStatsSchema,
  propertyImageSchema,
  propertyImageWithSpaceSchema,
};
