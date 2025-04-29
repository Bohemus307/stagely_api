// src/schemas/messaging-schema.ts

// Base conversation schema with common properties
const conversationBaseSchema = {
  type: "object",
  properties: {
    participants: {
      type: "array",
      items: { type: "integer" },
      description: "User IDs of participants"
    },
    name: {
      type: "string",
      nullable: true,
      description: "Optional name for the conversation"
    }
  }
};

// Schema for creating a new conversation
export const createConversationSchema = {
  ...conversationBaseSchema,
  properties: {
    ...conversationBaseSchema.properties,
    initialMessage: {
      type: "string",
      nullable: true,
      description: "Initial message to send (optional)"
    }
  },
  required: ["participants"],
  additionalProperties: false
};

// Schema for message status
const messageStatusSchema = {
  type: "object",
  additionalProperties: {
    type: "string",
    enum: ["SENT", "DELIVERED", "READ"]
  },
  description: "Status of message for each participant (userId -> status)"
};

// Schema for creating a new message
export const createMessageSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "Message text"
    }
  },
  required: ["text"],
  additionalProperties: false
};

// Schema for marking messages as read
export const markReadSchema = {
  type: "object",
  properties: {
    messageIds: {
      type: "array",
      items: { type: "string" },
      description: "IDs of messages to mark as read"
    }
  },
  required: ["messageIds"],
  additionalProperties: false
};

// Schema for sender information
const senderInfoSchema = {
  type: "object",
  properties: {
    firstName: { type: "string" },
    lastName: { type: "string" },
    profilePictureUrl: { type: "string", nullable: true }
  },
  nullable: true
};

// Schema for single message response
export const messageResponseSchema = {
  type: "object",
  properties: {
    messageId: { type: "string" },
    conversationId: { type: "string" },
    senderId: { type: "integer" },
    text: { type: "string" },
    timestamp: { type: "number" },
    status: messageStatusSchema,
    senderInfo: senderInfoSchema
  }
};

// Schema for multiple messages response
export const messagesResponseSchema = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: messageResponseSchema
    },
    lastKey: {
      type: "string",
      nullable: true,
      description: "Pagination key for fetching next batch of messages"
    }
  }
};

// Schema for single conversation response
export const conversationResponseSchema = {
  type: "object",
  properties: {
    conversationId: { type: "string" },
    participants: {
      type: "array",
      items: { type: "integer" }
    },
    name: {
      type: "string",
      nullable: true,
      description: "Optional name for the conversation"
    },
    createdAt: { type: "number" },
    lastMessageText: { type: "string", nullable: true },
    lastMessageTime: { type: "number", nullable: true },
    lastMessageSenderId: { type: "integer", nullable: true },
    unreadCount: {
      type: "object",
      additionalProperties: { type: "integer" },
      description: "Unread message count for each participant (userId -> count)"
    }
  }
};

// Schema for multiple conversations response
export const conversationsResponseSchema = {
  type: "object",
  properties: {
    conversations: {
      type: "array",
      items: conversationResponseSchema
    },
    lastKey: {
      type: "string",
      nullable: true,
      description: "Pagination key for fetching next batch of conversations"
    }
  }
};

// Schema for unread counts response
export const unreadCountResponseSchema = {
  type: "object",
  properties: {
    unreadCount: { type: "integer" },
    conversationsWithUnread: {
      type: "array",
      items: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          unreadCount: { type: "integer" },
          lastMessageText: { type: "string", nullable: true },
          lastMessageTime: { type: "number", nullable: true }
        }
      }
    }
  }
};

// Schema for initializing messaging user response
export const initializeUserResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    user: {
      type: "object",
      properties: {
        userId: { type: "integer" },
        email: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        profilePictureUrl: { type: "string", nullable: true },
        lastSeen: { type: "number" },
        createdAt: { type: "number" },
        updatedAt: { type: "number" }
      }
    }
  }
};

// Schema for adding participant to a conversation
export const addParticipantSchema = {
  type: "object",
  properties: {
    participantId: {
      type: "integer",
      description: "User ID of participant to add"
    }
  },
  required: ["participantId"],
  additionalProperties: false
};

// Connection schema
export const connectionSchema = {
  type: "object",
  properties: {
    connectionId: { type: "string" },
    userId: { type: "integer" },
    deviceId: { type: "string", nullable: true },
    timestamp: { type: "number" },
    ttl: { type: "number" }
  }
};

// Success response schema
export const successResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true }
  }
};

// Error response schema
export const errorResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    error: { type: "string" }
  }
};

// Export all the schemas
export default {
  createConversationSchema,
  createMessageSchema,
  markReadSchema,
  messageResponseSchema,
  messagesResponseSchema,
  conversationResponseSchema,
  conversationsResponseSchema,
  unreadCountResponseSchema,
  initializeUserResponseSchema,
  addParticipantSchema,
  connectionSchema,
  successResponseSchema,
  errorResponseSchema
};
