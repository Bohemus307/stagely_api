// src/routes/messaging/index.ts
import { FastifyInstance } from "fastify";
import { MessagingService } from "../../services/messaging";
import {
  sendNotFound,
  sendForbidden,
  sendUnauthorized,
} from "../../utils/responses";

// Define interface types for request parameters and bodies
interface CreateConversationBody {
  userId: number;
  participants: number[];
  initialMessage?: string;
}

interface SendMessageBody {
  userId: number;
  text: string;
}

interface MarkReadBody {
  userId: number;
  messageIds: string[];
}

interface ConversationParams {
  conversationId: string;
}

interface QueryParams {
  userId: number;
  limit?: string;
  lastKey?: string;
}

declare module "fastify" {
  interface FastifyInstance {
    dynamoDB: {
      client: any;
      documentClient: any;
    };
  }
}

/**
 * Basic messaging routes between existing users
 */
async function messagingRoutes(fastify: FastifyInstance): Promise<void> {
  // Create messaging service
  const messagingService = new MessagingService(
    fastify.prisma,
    fastify.dynamoDB.documentClient
  );

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
          userId: {
            type: "integer",
            description: "ID of the user creating the conversation"
          },
          participants: {
            type: "array",
            items: { type: "integer" },
            description: "User IDs of participants"
          },
          initialMessage: {
            type: "string",
            description: "Initial message to send (optional)"
          }
        },
        required: ["userId", "participants"]
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
        const { userId, participants, initialMessage } = request.body as CreateConversationBody;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId }
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        const result = await messagingService.createConversation(
          user.id,
          participants,
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
          error: err.message || "An unknown error occurred"
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
          userId: {
            type: "integer",
            description: "ID of the user"
          },
          limit: {
            type: "integer",
            description: "Maximum number of conversations to return"
          },
          lastKey: {
            type: "string",
            description: "Last evaluated key for pagination"
          }
        },
        required: ["userId"]
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
        const { userId, limit, lastKey } = request.query as QueryParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId }
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        const result = await messagingService.getConversationsForUser(
          user.id,
          limit ? parseInt(limit) : undefined,
          lastKey ? JSON.parse(lastKey) : undefined
        );

        return {
          conversations: result.conversations,
          lastKey: result.lastEvaluatedKey
            ? JSON.stringify(result.lastEvaluatedKey)
            : null
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred"
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
      querystring: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the user"
          }
        },
        required: ["userId"]
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
        const { userId } = request.query as { userId: number };
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId }
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        try {
          const conversation = await messagingService.getConversationById(
            conversationId,
            user.id
          );

          return {
            success: true,
            conversation
          };
        } catch (err: any) {
          if (err.name === "NotFoundError") {
            return sendNotFound(reply, "Conversation not found");
          }
          if (err.message.includes("not a participant")) {
            return sendForbidden(
              reply,
              "You don't have permission to access this conversation"
            );
          }
          throw err;
        }
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred"
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
          userId: {
            type: "integer",
            description: "ID of the user"
          },
          limit: {
            type: "integer",
            description: "Maximum number of messages to return"
          },
          lastKey: {
            type: "string",
            description: "Last evaluated key for pagination"
          }
        },
        required: ["userId"]
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
        const { userId, limit, lastKey } = request.query as QueryParams;
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId }
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        try {
          const result = await messagingService.getMessages(
            conversationId,
            user.id,
            limit ? parseInt(limit) : undefined,
            lastKey ? JSON.parse(lastKey) : undefined
          );

          return {
            messages: result.messages,
            lastKey: result.lastEvaluatedKey
              ? JSON.stringify(result.lastEvaluatedKey)
              : null
          };
        } catch (err: any) {
          if (err.name === "NotFoundError") {
            return sendNotFound(reply, "Conversation not found");
          }
          if (err.message.includes("not a participant")) {
            return sendForbidden(
              reply,
              "You don't have permission to access this conversation"
            );
          }
          throw err;
        }
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred"
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
          userId: {
            type: "integer",
            description: "ID of the user sending the message"
          },
          text: {
            type: "string",
            description: "Message text"
          }
        },
        required: ["userId", "text"]
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
        const { userId, text } = request.body as SendMessageBody;
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId }
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        try {
          const message = await messagingService.sendMessage(
            conversationId,
            user.id,
            text
          );

          return {
            success: true,
            message
          };
        } catch (err: any) {
          if (err.name === "NotFoundError") {
            return sendNotFound(reply, "Conversation not found");
          }
          if (err.message.includes("not a participant")) {
            return sendForbidden(
              reply,
              "You don't have permission to access this conversation"
            );
          }
          throw err;
        }
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred"
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
          userId: {
            type: "integer",
            description: "ID of the user marking messages as read"
          },
          messageIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of messages to mark as read"
          }
        },
        required: ["userId", "messageIds"]
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
        const { userId, messageIds } = request.body as MarkReadBody;
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId }
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        try {
          await messagingService.markMessagesAsRead(
            conversationId,
            user.id,
            messageIds
          );

          return {
            success: true
          };
        } catch (err: any) {
          if (err.name === "NotFoundError") {
            return sendNotFound(reply, "Conversation not found");
          }
          if (err.message.includes("not a participant")) {
            return sendForbidden(
              reply,
              "You don't have permission to access this conversation"
            );
          }
          throw err;
        }
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred"
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
      querystring: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the user"
          }
        },
        required: ["userId"]
      },
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
                  lastMessageTime: { type: "string" }
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
        const { userId } = request.query as { userId: number };

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId }
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        const result = await messagingService.getUnreadCount(user.id);

        return result;
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred"
        });
      }
    }
  });
}

export default messagingRoutes;
