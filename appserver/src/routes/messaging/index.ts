// src/routes/messaging/index.ts
import { FastifyInstance } from "fastify";
import { MessagingService } from "../../services/messaging";
import {
  DynamoDBConversation,
} from "../../repositories/dynamoDB/conversationRepository";
import { Incident } from "@prisma/client";
import { sendUnauthorized, sendNotFound } from "../../utils/responses";

// Define interface types for request parameters and bodies
interface CreateConversationBody {
  participants: number[];
  propertyId?: number;
  incidentId?: number;
  type: 'property_related' | 'incident_related' | 'general';
  initialMessage?: string;
}

interface PropertyConversationBody {
  propertyId: number;
  initialMessage?: string;
}

interface SendMessageBody {
  text: string;
  attachments?: Array<{
    url: string;
    type: string;
    filename: string;
    size: number;
  }>;
}

interface MarkReadBody {
  messageIds: string[];
}

interface ConversationParams {
  conversationId: string;
}

interface ParticipantParams extends ConversationParams {
  participantId: string;
}

interface PropertyParams {
  propertyId: string;
}

interface QueryParams {
  limit?: string;
  lastKey?: string;
}

/**
 * Messaging routes
 *
 * @param fastify - The Fastify instance
 */
async function messagingRoutes(fastify: FastifyInstance): Promise<void> {
  // Create messaging service
  const messagingService = new MessagingService(
    fastify.prisma,
    fastify.dynamoDB.documentClient
  );

  // Initialize the messaging user
  fastify.route({
    method: "POST",
    url: "/initialize",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Initialize a user for messaging",
      summary: "Initialize messaging user",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            user: { type: "object" }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const messagingUser = await messagingService.initializeUser(user.auth0Id);

        return {
          success: true,
          user: messagingUser
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Get all conversations for the current user
  fastify.route({
    method: "GET",
    url: "/conversations",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Get all conversations for the current user",
      summary: "List user conversations",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of conversations to return"
          },
          lastKey: {
            type: "string",
            description: "Last evaluated key for pagination"
          }
        }
      },
      response: {
        200: {
          type: "object",
          properties: {
            conversations: {
              type: "array",
              items: { type: "object" }
            },
            lastKey: { type: "string", nullable: true }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { limit, lastKey } = request.query as QueryParams;

        const result = await messagingService.getConversationsForUser(
          user.id,
          limit ? parseInt(limit) : undefined,
          lastKey ? JSON.parse(lastKey) : undefined
        );

        return {
          conversations: result.conversations,
          lastKey: result.lastEvaluatedKey ? JSON.stringify(result.lastEvaluatedKey) : null
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Create a new conversation
  fastify.route({
    method: "POST",
    url: "/conversations",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Create a new conversation",
      summary: "Create conversation",
      body: {
        type: "object",
        properties: {
          participants: {
            type: "array",
            items: { type: "integer" },
            description: "User IDs of participants"
          },
          propertyId: {
            type: "integer",
            description: "Associated property ID (optional)"
          },
          incidentId: {
            type: "integer",
            description: "Associated incident ID (optional)"
          },
          type: {
            type: "string",
            enum: ["property_related", "incident_related", "general"],
            description: "Conversation type"
          },
          initialMessage: {
            type: "string",
            description: "Initial message to send (optional)"
          }
        },
        required: ["participants", "type"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" },
            message: { type: "object", nullable: true }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { participants, propertyId, incidentId, type, initialMessage } = request.body as CreateConversationBody;

        const conversation = await messagingService.createConversation(
          user.id,
          participants,
          type,
          propertyId,
          incidentId
        );

        // Send initial message if provided
        let message;
        if (initialMessage) {
          message = await messagingService.sendMessage(
            conversation.conversationId,
            user.id,
            initialMessage
          );
        }

        return {
          success: true,
          conversation,
          message
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Create a conversation for a property
  fastify.route({
    method: "POST",
    url: "/property-conversation",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Create a conversation for a specific property",
      summary: "Create property conversation",
      body: {
        type: "object",
        properties: {
          propertyId: {
            type: "integer",
            description: "Property ID"
          },
          initialMessage: {
            type: "string",
            description: "Initial message to send (optional)"
          }
        },
        required: ["propertyId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" },
            message: { type: "object", nullable: true }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { propertyId, initialMessage } = request.body as PropertyConversationBody;

        // Verify property belongs to the user
        const property = await fastify.prisma.property.findUnique({
          where: { id: propertyId }
        });

        if (!property || property.userId !== user.id) {
          return sendUnauthorized(reply, "You don't have permission to access this property");
        }

        // Create property conversation
        const result = await messagingService.createPropertyConversation(
          user.id,
          propertyId,
          initialMessage
        );

        return {
          success: true,
          conversation: result.conversation,
          message: result.message
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Get conversation by ID
  fastify.route({
    method: "GET",
    url: "/conversations/:conversationId",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Get a conversation by ID",
      summary: "Get conversation",
      params: {
        type: "object",
        properties: {
          conversationId: {
            type: "string",
            description: "Conversation ID"
          }
        },
        required: ["conversationId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" }
          }
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Conversation not found" }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { conversationId } = request.params as ConversationParams;

        const conversation = await messagingService.getConversationById(conversationId);

        if (!conversation) {
          return reply.code(404).send({
            success: false,
            error: 'Conversation not found'
          });
        }

        // Check if user is a participant
        if (!conversation.participants.includes(user.id)) {
          return sendUnauthorized(reply, "You don't have permission to access this conversation");
        }

        return {
          success: true,
          conversation
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Get messages for a conversation
  fastify.route({
    method: "GET",
    url: "/conversations/:conversationId/messages",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Get messages for a conversation",
      summary: "Get conversation messages",
      params: {
        type: "object",
        properties: {
          conversationId: {
            type: "string",
            description: "Conversation ID"
          }
        },
        required: ["conversationId"]
      },
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of messages to return"
          },
          lastKey: {
            type: "string",
            description: "Last evaluated key for pagination"
          }
        }
      },
      response: {
        200: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              items: { type: "object" }
            },
            lastKey: { type: "string", nullable: true }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { conversationId } = request.params as ConversationParams;
        const { limit, lastKey } = request.query as QueryParams;

        // Verify the conversation exists and user is a participant
        const conversation = await messagingService.getConversationById(conversationId);

        if (!conversation) {
          return reply.code(404).send({
            success: false,
            error: 'Conversation not found'
          });
        }

        if (!conversation.participants.includes(user.id)) {
          return sendUnauthorized(reply, "You don't have permission to access this conversation");
        }

        const result = await messagingService.getMessages(
          conversationId,
          user.id,
          limit ? parseInt(limit) : undefined,
          lastKey ? JSON.parse(lastKey) : undefined
        );

        return {
          messages: result.messages,
          lastKey: result.lastEvaluatedKey ? JSON.stringify(result.lastEvaluatedKey) : null
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Send a message in a conversation
  fastify.route({
    method: "POST",
    url: "/conversations/:conversationId/messages",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Send a message in a conversation",
      summary: "Send message",
      params: {
        type: "object",
        properties: {
          conversationId: {
            type: "string",
            description: "Conversation ID"
          }
        },
        required: ["conversationId"]
      },
      body: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Message text"
          },
          attachments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                type: { type: "string" },
                filename: { type: "string" },
                size: { type: "number" }
              }
            },
            description: "Message attachments (optional)"
          }
        },
        required: ["text"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "object" }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { conversationId } = request.params as ConversationParams;
        const { text, attachments } = request.body as SendMessageBody;

        // Verify the conversation exists and user is a participant
        const conversation = await messagingService.getConversationById(conversationId);

        if (!conversation) {
          return reply.code(404).send({
            success: false,
            error: 'Conversation not found'
          });
        }

        if (!conversation.participants.includes(user.id)) {
          return sendUnauthorized(reply, "You don't have permission to access this conversation");
        }

        const message = await messagingService.sendMessage(
          conversationId,
          user.id,
          text,
        );

        return {
          success: true,
          message
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Mark messages as read
  fastify.route({
    method: "POST",
    url: "/conversations/:conversationId/read",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Mark messages as read",
      summary: "Mark messages read",
      params: {
        type: "object",
        properties: {
          conversationId: {
            type: "string",
            description: "Conversation ID"
          }
        },
        required: ["conversationId"]
      },
      body: {
        type: "object",
        properties: {
          messageIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of messages to mark as read"
          }
        },
        required: ["messageIds"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { conversationId } = request.params as ConversationParams;
        const { messageIds } = request.body as MarkReadBody;

        // Verify the conversation exists and user is a participant
        const conversation = await messagingService.getConversationById(conversationId);

        if (!conversation) {
          return reply.code(404).send({
            success: false,
            error: 'Conversation not found'
          });
        }

        if (!conversation.participants.includes(user.id)) {
          return sendUnauthorized(reply, "You don't have permission to access this conversation");
        }

        await messagingService.markMessagesAsRead(
          conversationId,
          user.id,
          messageIds
        );

        return {
          success: true
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Add a participant to a conversation
  fastify.route({
    method: "POST",
    url: "/conversations/:conversationId/participants",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Add a participant to a conversation",
      summary: "Add conversation participant",
      params: {
        type: "object",
        properties: {
          conversationId: {
            type: "string",
            description: "Conversation ID"
          }
        },
        required: ["conversationId"]
      },
      body: {
        type: "object",
        properties: {
          participantId: {
            type: "integer",
            description: "User ID of participant to add"
          }
        },
        required: ["participantId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { conversationId } = request.params as ConversationParams;
        const { participantId } = request.body as { participantId: number };

        // Get conversation to verify user is a participant
        const conversation = await messagingService.getConversationById(conversationId);

        if (!conversation) {
          return reply.code(404).send({
            success: false,
            error: 'Conversation not found'
          });
        }

        // Check if user is a participant
        if (!conversation.participants.includes(user.id)) {
          return sendUnauthorized(reply, "You don't have permission to modify this conversation");
        }

        // Add the new participant
        const updatedConversation = await messagingService.addParticipantToConversation(
          conversationId,
          participantId
        );

        return {
          success: true,
          conversation: updatedConversation
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Remove a participant from a conversation
  fastify.route({
    method: "DELETE",
    url: "/conversations/:conversationId/participants/:participantId",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Remove a participant from a conversation",
      summary: "Remove conversation participant",
      params: {
        type: "object",
        properties: {
          conversationId: {
            type: "string",
            description: "Conversation ID"
          },
          participantId: {
            type: "string",
            description: "User ID of participant to remove"
          }
        },
        required: ["conversationId", "participantId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { conversationId, participantId } = request.params as ParticipantParams;

        // Get conversation to verify user is a participant
        const conversation = await messagingService.getConversationById(conversationId);

        if (!conversation) {
          return reply.code(404).send({
            success: false,
            error: 'Conversation not found'
          });
        }

        // Only allow removal if:
        // 1. User is removing themselves
        // 2. User is removing someone else (would need additional permission check in a real app)
        const isRemovingSelf = user.id === parseInt(participantId);

        if (!conversation.participants.includes(user.id) && !isRemovingSelf) {
          return sendUnauthorized(reply, "You don't have permission to modify this conversation");
        }

        // Remove the participant
        const updatedConversation = await messagingService.removeParticipantFromConversation(
          conversationId,
          parseInt(participantId)
        );

        return {
          success: true,
          conversation: updatedConversation
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Get conversations for a property
  fastify.route({
    method: "GET",
    url: "/property/:propertyId/conversations",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Get conversations for a property",
      summary: "Get property conversations",
      params: {
        type: "object",
        properties: {
          propertyId: {
            type: "string",
            description: "Property ID"
          }
        },
        required: ["propertyId"]
      },
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of conversations to return"
          },
          lastKey: {
            type: "string",
            description: "Last evaluated key for pagination"
          }
        }
      },
      response: {
        200: {
          type: "object",
          properties: {
            conversations: {
              type: "array",
              items: { type: "object" }
            },
            lastKey: { type: "string", nullable: true }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { propertyId } = request.params as PropertyParams;
        const { limit, lastKey } = request.query as QueryParams;

        // Verify property belongs to the user
        const property = await fastify.prisma.property.findUnique({
          where: { id: parseInt(propertyId) }
        });

        if (!property || property.userId !== user.id) {
          return sendUnauthorized(reply, "You don't have permission to access this property");
        }

        const conversationsResult = await messagingService.getConversationsForProperty(
          parseInt(propertyId),
          limit ? parseInt(limit) : undefined,
          lastKey ? JSON.parse(lastKey) : undefined
        );

        // Filter conversations to only include those the user is part of
        const userConversations = conversationsResult.conversations.filter(
          (conv: DynamoDBConversation) => conv.participants.includes(user.id)
        );

        return {
          conversations: userConversations,
          lastKey: conversationsResult.lastEvaluatedKey ? JSON.stringify(conversationsResult.lastEvaluatedKey) : null
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Get property incidents with conversations
  fastify.route({
    method: "GET",
    url: "/property/:propertyId/incidents-with-conversations",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Get property incidents with their associated conversations",
      summary: "Get property incidents with conversations",
      params: {
        type: "object",
        properties: {
          propertyId: {
            type: "string",
            description: "Property ID"
          }
        },
        required: ["propertyId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            incidentsWithConversations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  incident: { type: "object" },
                  conversation: {
                    type: "object",
                    nullable: true
                  }
                }
              }
            }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const { propertyId } = request.params as PropertyParams;

        // Verify property belongs to the user
        const property = await fastify.prisma.property.findUnique({
          where: { id: parseInt(propertyId) }
        });

        if (!property || property.userId !== user.id) {
          return sendUnauthorized(reply, "You don't have permission to access this property");
        }

        // Get incidents for the property
        const incidents = await fastify.prisma.incident.findMany({
          where: {
            propertyId: parseInt(propertyId)
          },
          orderBy: {
            createdAt: 'desc'
          }
        });

        // For each incident, check if there's a conversation
        const incidentsWithConversations = await Promise.all(
          incidents.map(async (incident: Incident) => {
            // Find conversation for this incident by property
            const conversationsResult = await messagingService.getConversationsForProperty(
              parseInt(propertyId)
            );

            // Filter for incident-specific conversations
            const incidentConversation = conversationsResult.conversations.find(
              (conv: DynamoDBConversation) =>
                conv.incidentId === incident.id &&
                conv.conversationType === 'incident_related' &&
                conv.participants.includes(user.id)
            );

            return {
              incident,
              conversation: incidentConversation || null
            };
          })
        );

        return {
          incidentsWithConversations
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });

  // Get unread conversation count for user
  fastify.route({
    method: "GET",
    url: "/unread-count",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Get count of unread messages for the current user",
      summary: "Get unread message count",
      response: {
        200: {
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
                  lastMessageText: { type: "string" },
                  lastMessageTime: { type: "string", format: "date-time" }
                }
              }
            }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        // Get all conversations for user
        const result = await messagingService.getConversationsForUser(user.id, 100);

        // Count unread messages
        let totalUnread = 0;

        result.conversations.forEach(conversation => {
          const userIdStr = user.id.toString();
          if (conversation.unreadCount && conversation.unreadCount[userIdStr]) {
            totalUnread += conversation.unreadCount[userIdStr];
          }
        });

        return {
          unreadCount: totalUnread,
          conversationsWithUnread: result.conversations
            .filter(conv => {
              const userIdStr = user.id.toString();
              return conv.unreadCount && conv.unreadCount[userIdStr] > 0;
            })
            .map(conv => ({
              conversationId: conv.conversationId,
              unreadCount: conv.unreadCount[user.id.toString()] || 0,
              lastMessageText: conv.lastMessageText,
              lastMessageTime: conv.lastMessageTime
            }))
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || 'An unknown error occurred'
        });
      }
    }
  });
}

export default messagingRoutes;
