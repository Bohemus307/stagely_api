// Define schemas for invitation-related routes

// Schema for invite user request
export const inviteUserSchema = {
  type: "object",
  properties: {
    email: {
      type: "string",
      format: "email",
      description: "Email to invite",
    },
  },
  required: ["email"],
};

// Schema for invite user response
export const inviteUserResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    user: {
      type: "object",
      properties: {
        id: { type: "integer" },
        email: { type: "string" },
        isPlaceholder: { type: "boolean" },
      },
    },
  },
};

// Schema for accept invitation request
export const acceptInvitationSchema = {
  type: "object",
  properties: {
    token: {
      type: "string",
      description: "Invitation token",
    },
  },
  required: ["token"],
};

// Schema for accept invitation response
export const acceptInvitationResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    message: { type: "string" },
  },
};

// Schema for check invitation query
export const checkInvitationQuerySchema = {
  type: "object",
  properties: {
    token: {
      type: "string",
      description: "Invitation token",
    },
  },
  required: ["token"],
};

// Schema for check invitation response
export const checkInvitationResponseSchema = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    email: { type: "string", nullable: true },
  },
};

// Schema for resend invitation request
export const resendInvitationSchema = {
  type: "object",
  properties: {
    email: {
      type: "string",
      format: "email",
      description: "Email to resend invitation to",
    },
  },
  required: ["email"],
};

// Schema for resend invitation response
export const resendInvitationResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    user: {
      type: "object",
      properties: {
        id: { type: "integer" },
        email: { type: "string" },
        isPlaceholder: { type: "boolean" },
      },
    },
  },
};

// Export all schemas
export default {
  inviteUserSchema,
  inviteUserResponseSchema,
  acceptInvitationSchema,
  checkInvitationQuerySchema,
  checkInvitationResponseSchema,
  resendInvitationSchema,
  resendInvitationResponseSchema,
};
