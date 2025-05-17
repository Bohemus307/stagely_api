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

interface ParticipantParams extends ConversationParams {
  participantId: string;
}

interface QueryParams {
  userId: number;
  limit?: string;
  lastKey?: string;
}

interface InviteUserResponse {
  success: boolean;
  user: {
    id: number;
    email: string;
    isPlaceholder: boolean;
  };
}

declare module "fastify" {
  interface FastifyInstance {
    dynamoDB: {
      client: any;
      documentClient: any;
    };
    email: {
      sendInvitationEmail: (
        email: string,
        token: string,
        inviterName: string,
      ) => Promise<string>;
    };
  }
}

/**
 * Messaging routes - all routes use Auth0 authentication
 *
 * @param fastify - The Fastify instance
 */
async function messagingRoutes(fastify: FastifyInstance): Promise<void> {
  // Create messaging service
  const messagingService = new MessagingService(
    fastify.prisma,
    fastify.dynamoDB.documentClient,
  );

  // Create conversation with invited user
  fastify.route({
    method: "POST",
    url: "/invite-conversation",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["messaging"],
      description: "Create a conversation with an invited user",
      summary: "Create invited user conversation",
      body: {
        type: "object",
        properties: {
          userId: {
            type: "number",
            description: "id of the user inviting",
          },
          email: {
            type: "string",
            format: "email",
            description: "Email of the user to invite",
          },
          initialMessage: {
            type: "string",
            description: "Initial message to send (optional)",
          },
        },
        required: ["email", "userId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" },
            message: { type: "object", nullable: true },
            user: { type: "object" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { email, userId, initialMessage } = request.body as {
          email: string;
          userId: number;
          initialMessage?: string;
        };

        // Get user by id and verify its auth0 id based on the sub then use that user much faster since its indexed by id
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        // Log that we're about to invoke the service method
        fastify.log.info({
          action: "inviteUserAndCreateConversation",
          user: user.id,
          email,
          hasInitialMessage: !!initialMessage,
          hasEmailService: !!fastify.email,
        });

        // Use the service to handle all business logic
        const result = await messagingService.inviteUserAndCreateConversation(
          user.id,
          email,
          initialMessage,
          fastify, // Pass fastify to the service method
        );

        // Note: The email sending is now handled in the service
        // If we have a token and need to verify the email was sent
        if (result.invitationToken) {
          fastify.log.info({
            message: "Route handler: Invitation created",
            email,
            tokenPrefix: result.invitationToken.substring(0, 8),
          });
        }

        // Remove invitationToken from response
        const { invitationToken, ...responseData } = result;

        return {
          success: true,
          ...responseData,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "ID of the user",
          },
          limit: {
            type: "integer",
            description: "Maximum number of conversations to return",
          },
          lastKey: {
            type: "string",
            description: "Last evaluated key for pagination",
          },
        },
        required: ["userId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            conversations: {
              type: "array",
              items: { type: "object" },
            },
            lastKey: { type: "string", nullable: true },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId, limit, lastKey } = request.query as QueryParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        const result = await messagingService.getConversationsForUser(
          user.id,
          limit ? parseInt(limit) : undefined,
          lastKey ? JSON.parse(lastKey) : undefined,
        );

        return {
          conversations: result.conversations,
          lastKey: result.lastEvaluatedKey
            ? JSON.stringify(result.lastEvaluatedKey)
            : null,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
          userId: {
            type: "integer",
            description: "ID of the user creating the conversation",
          },
          participants: {
            type: "array",
            items: { type: "integer" },
            description: "User IDs of participants",
          },
          type: {
            type: "string",
            enum: ["general"],
            description: "Conversation type",
          },
          initialMessage: {
            type: "string",
            description: "Initial message to send (optional)",
          },
        },
        required: ["userId", "participants", "type"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" },
            message: { type: "object", nullable: true },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId, participants, initialMessage } =
          request.body as CreateConversationBody;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        const conversation = await messagingService.createConversation(
          user.id,
          participants,
        );

        // Send initial message if provided
        let message;
        if (initialMessage) {
          message = await messagingService.sendMessage(
            conversation.conversationId,
            user.id,
            initialMessage,
          );
        }

        return {
          success: true,
          conversation,
          message,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "Conversation ID",
          },
        },
        required: ["conversationId"],
      },
      querystring: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the user",
          },
        },
        required: ["userId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Conversation not found" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId } = request.query as { userId: number };
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        const conversation = await messagingService.getConversationById(
          conversationId,
          user.id,
        );

        if (!conversation) {
          return sendNotFound(reply, "Conversation not found");
        }

        // Check if user is a participant
        if (!conversation.participants.includes(user.id)) {
          return sendForbidden(
            reply,
            "You don't have permission to access this conversation",
          );
        }

        return {
          success: true,
          conversation,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "Conversation ID",
          },
        },
        required: ["conversationId"],
      },
      querystring: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the user",
          },
          limit: {
            type: "integer",
            description: "Maximum number of messages to return",
          },
          lastKey: {
            type: "string",
            description: "Last evaluated key for pagination",
          },
        },
        required: ["userId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              items: { type: "object" },
            },
            lastKey: { type: "string", nullable: true },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId, limit, lastKey } = request.query as QueryParams;
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        // Verify the conversation exists and user is a participant
        const conversation = await messagingService.getConversationById(
          conversationId,
          user.id,
        );

        if (!conversation) {
          return sendNotFound(reply, "Conversation not found");
        }

        if (!conversation.participants.includes(user.id)) {
          return sendForbidden(
            reply,
            "You don't have permission to access this conversation",
          );
        }

        const result = await messagingService.getMessages(
          conversationId,
          user.id,
          limit ? parseInt(limit) : undefined,
          lastKey ? JSON.parse(lastKey) : undefined,
        );

        return {
          messages: result.messages,
          lastKey: result.lastEvaluatedKey
            ? JSON.stringify(result.lastEvaluatedKey)
            : null,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "Conversation ID",
          },
        },
        required: ["conversationId"],
      },
      body: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the user sending the message",
          },
          text: {
            type: "string",
            description: "Message text",
          },
        },
        required: ["userId", "text"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "object" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId, text } = request.body as SendMessageBody;
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        // Verify the conversation exists and user is a participant
        const conversation = await messagingService.getConversationById(
          conversationId,
          user.id,
        );

        if (!conversation) {
          return sendNotFound(reply, "Conversation not found");
        }

        if (!conversation.participants.includes(user.id)) {
          return sendForbidden(
            reply,
            "You don't have permission to access this conversation",
          );
        }

        const message = await messagingService.sendMessage(
          conversationId,
          user.id,
          text,
          fastify,
        );

        return {
          success: true,
          message,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "Conversation ID",
          },
        },
        required: ["conversationId"],
      },
      body: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the user marking messages as read",
          },
          messageIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of messages to mark as read",
          },
        },
        required: ["userId", "messageIds"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId, messageIds } = request.body as MarkReadBody;
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        // Verify the conversation exists and user is a participant
        const conversation = await messagingService.getConversationById(
          conversationId,
          user.id,
        );

        if (!conversation) {
          return sendNotFound(reply, "Conversation not found");
        }

        if (!conversation.participants.includes(user.id)) {
          return sendForbidden(
            reply,
            "You don't have permission to access this conversation",
          );
        }

        await messagingService.markMessagesAsRead(
          conversationId,
          user.id,
          messageIds,
        );

        return {
          success: true,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "Conversation ID",
          },
        },
        required: ["conversationId"],
      },
      body: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the requesting user",
          },
          participantId: {
            type: "integer",
            description: "User ID of participant to add",
          },
        },
        required: ["userId", "participantId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId, participantId } = request.body as {
          userId: number;
          participantId: number;
        };
        const { conversationId } = request.params as ConversationParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        // Get conversation to verify user is a participant
        const conversation = await messagingService.getConversationById(
          conversationId,
          user.id,
        );

        if (!conversation) {
          return sendNotFound(reply, "Conversation not found");
        }

        // Check if user is a participant
        if (!conversation.participants.includes(user.id)) {
          return sendForbidden(
            reply,
            "You don't have permission to modify this conversation",
          );
        }

        // Add the new participant
        const updatedConversation =
          await messagingService.addParticipantToConversation(
            conversationId,
            participantId,
            user.id,
          );

        return {
          success: true,
          conversation: updatedConversation,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "Conversation ID",
          },
          participantId: {
            type: "string",
            description: "User ID of participant to remove",
          },
        },
        required: ["conversationId", "participantId"],
      },
      querystring: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "ID of the requesting user",
          },
        },
        required: ["userId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            conversation: { type: "object" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId } = request.query as { userId: number };
        const { conversationId, participantId } =
          request.params as ParticipantParams;

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        // Get conversation to verify user is a participant
        const conversation = await messagingService.getConversationById(
          conversationId,
          user.id,
        );

        if (!conversation) {
          return sendNotFound(reply, "Conversation not found");
        }

        // Only allow removal if:
        // 1. User is removing themselves
        // 2. User is removing someone else (would need additional permission check in a real app)
        const isRemovingSelf = user.id === parseInt(participantId);

        if (!conversation.participants.includes(user.id) && !isRemovingSelf) {
          return sendForbidden(
            reply,
            "You don't have permission to modify this conversation",
          );
        }

        // Remove the participant
        const updatedConversation =
          await messagingService.removeParticipantFromConversation(
            conversationId,
            parseInt(participantId),
            user.id,
          );

        return {
          success: true,
          conversation: updatedConversation,
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
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
            description: "ID of the user",
          },
        },
        required: ["userId"],
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
                  lastMessageTime: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { userId } = request.query as { userId: number };

        // Get user by id and verify its auth0 id matches
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user || user.auth0Id !== request?.user?.sub) {
          return sendUnauthorized(reply, "User not found or not authorized");
        }

        // Get all conversations for user
        const result = await messagingService.getConversationsForUser(
          user.id,
          100,
        );

        // Count unread messages
        let totalUnread = 0;

        result.conversations.forEach((conversation) => {
          const userIdStr = user.id.toString();
          if (conversation.unreadCount && conversation.unreadCount[userIdStr]) {
            totalUnread += conversation.unreadCount[userIdStr];
          }
        });

        return {
          unreadCount: totalUnread,
          conversationsWithUnread: result.conversations
            .filter((conv) => {
              const userIdStr = user.id.toString();
              return conv.unreadCount && conv.unreadCount[userIdStr] > 0;
            })
            .map((conv) => ({
              conversationId: conv.conversationId,
              unreadCount: conv.unreadCount[user.id.toString()] || 0,
              lastMessageText: conv.lastMessageText,
              lastMessageTime: conv.lastMessageTime,
            })),
        };
      } catch (err: any) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          error: err.message || "An unknown error occurred",
        });
      }
    },
  });
}

export default messagingRoutes;
