// Define schemas for user-related routes

// Base user schema with common properties
const userBaseSchema = {
  type: "object",
  properties: {
    email: { type: "string", format: "email" },
    firstName: { type: "string" },
    lastName: { type: "string" },
    phone: { type: "string" },
    role: {
      type: "string",
      enum: ["user", "admin", "manager"],
      default: "user",
    },
    profilePictureUrl: { type: "string", format: "uri" },
  },
};

// Schema for creating a new user
export const createUserSchema = {
  ...userBaseSchema,
  properties: {
    ...userBaseSchema.properties,
    auth0Id: { type: "string" },
  },
  required: ["email", "firstName", "lastName", "auth0Id"],
  additionalProperties: false,
};

// Schema for updating an existing user
export const updateUserSchema = {
  ...userBaseSchema,
  additionalProperties: false,
};

// Schema for user's basic information
const userBasicInfoSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    firstName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string", format: "email" },
    profilePictureUrl: { type: "string", format: "uri" },
  },
};

// Schema for a single user response
export const userResponseSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    ...userBaseSchema.properties,
    auth0Id: { type: "string" },
    lastLogin: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    properties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          address: { type: "string" },
          city: { type: "string" },
          status: { type: "string" },
        },
      },
    },
  },
};

// Schema for multiple users response
export const usersResponseSchema = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          auth0Id: { type: "string" },
          email: { type: "string", format: "email" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          phone: { type: "string" },
          role: { type: "string" },
          profilePictureUrl: { type: "string", format: "uri" },
          lastLogin: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          _count: {
            type: "object",
            properties: {
              properties: { type: "integer" },
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

// Schema for user stats response
export const userStatsResponseSchema = {
  type: "object",
  properties: {
    totalProperties: { type: "integer" },
    activeProperties: { type: "integer" },
    totalIncidents: { type: "integer" },
    openIncidents: { type: "integer" },
    recentActivity: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["property_created", "incident_reported"],
          },
          timestamp: { type: "string", format: "date-time" },
          details: { type: "object" },
        },
      },
    },
  },
};

// Search results schema
export const userSearchResponseSchema = {
  type: "array",
  items: userBasicInfoSchema,
};

// Make sure these exports match what you're requiring in your routes file
export default {
  createUserSchema,
  updateUserSchema,
  userResponseSchema,
  usersResponseSchema,
  userStatsResponseSchema,
  userSearchResponseSchema,
};
