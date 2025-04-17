// src/routes/messaging/index.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MessagingService } from "../../services/messaging";
import {
    DynamoDBConversation,
  } from "../../repositories/dynamoDB/conversationRepository";
import { Incident } from "@prisma/client";
import { sendUnauthorized } from "../../utils/responses";

interface CreateConversationBody {
  participants: number[];
  propertyId?: number;
  incidentId?: number;
  type: 'property_related' | 'incident_related' | 'general';
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

interface QueryParams {
  limit?: string;
  lastKey?: string;
}

interface JWTUser {
  userId: number;
  auth0Id: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JWTUser;
  }
}

/**
 * Messaging routes
 */
async function messagingRoutes(fastify: FastifyInstance): Promise<void> {
  // Create messaging service
  const messagingService = new MessagingService(
    fastify.prisma,
    fastify.dynamoDB.documentClient
  );

  // Authenticate middleware
  /**
   * Simple JWT verification middleware
   */
  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Your actual JWT verification logic would go here
      // For example: await request.jwtVerify();

      // If you don't have the jwtVerify method, you can check the authorization header manually:
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return sendUnauthorized(reply);
      }

      // Manually parse and verify the token
      // This is just a placeholder, you should implement proper JWT verification
      // request.user = { userId: 1, role: "admin" }; // Set from decoded token
    } catch (err) {
      return sendUnauthorized(reply);
    }
  }

  // Initialize the messaging user
  fastify.post('/initialize', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { auth0Id } = request.user;
      const user = await messagingService.initializeUser(auth0Id);

      return {
        success: true,
        user
      };
    } catch (err: any) {
      fastify.log.error(err);
      reply.code(500).send({
        success: false,
        error: err.message || 'An unknown error occurred'
      });
    }
  });

  // Get all conversations for the current user
  fastify.get('/conversations', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { limit, lastKey } = request.query as QueryParams;

      const result = await messagingService.getConversationsForUser(
        userId,
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
  });

  // Create a new conversation
  fastify.post('/conversations', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { participants, propertyId, incidentId, type, initialMessage } = request.body as CreateConversationBody;

      const conversation = await messagingService.createConversation(
        userId,
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
          userId,
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
  });

  // Create a conversation for a property
  fastify.post('/property-conversation', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { propertyId, initialMessage } = request.body as { propertyId: number, initialMessage?: string };

      // Create property conversation
      const result = await messagingService.createPropertyConversation(
        userId,
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
  });

  // Get conversation by ID
  fastify.get('/conversations/:conversationId', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { conversationId } = request.params as ConversationParams;

      const conversation = await messagingService.getConversationById(conversationId);

      if (!conversation) {
        return reply.code(404).send({
          success: false,
          error: 'Conversation not found'
        });
      }

      // Check if user is a participant
      if (!conversation.participants.includes(userId)) {
        return reply.code(403).send({
          success: false,
          error: 'Access denied'
        });
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
  });

  // Get messages for a conversation
  fastify.get('/conversations/:conversationId/messages', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { conversationId } = request.params as ConversationParams;
      const { limit, lastKey } = request.query as QueryParams;

      const result = await messagingService.getMessages(
        conversationId,
        userId,
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
  });

  // Send a message in a conversation
  fastify.post('/conversations/:conversationId/messages', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { conversationId } = request.params as ConversationParams;
      const { text, attachments } = request.body as SendMessageBody;

      const message = await messagingService.sendMessage(
        conversationId,
        userId,
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
  });

  // Mark messages as read
  fastify.post('/conversations/:conversationId/read', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { conversationId } = request.params as ConversationParams;
      const { messageIds } = request.body as MarkReadBody;

      await messagingService.markMessagesAsRead(
        conversationId,
        userId,
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
  });

  // Add a participant to a conversation
  fastify.post('/conversations/:conversationId/participants', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
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
      if (!conversation.participants.includes(userId)) {
        return reply.code(403).send({
          success: false,
          error: 'Access denied'
        });
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
  });

  // Remove a participant from a conversation
  fastify.delete('/conversations/:conversationId/participants/:participantId', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { conversationId } = request.params as ConversationParams;
      const { participantId } = request.params as { participantId: string };

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
      const isRemovingSelf = userId === parseInt(participantId);

      if (!conversation.participants.includes(userId) && !isRemovingSelf) {
        return reply.code(403).send({
          success: false,
          error: 'Access denied'
        });
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
  });

  // Get conversations for a property
  fastify.get('/property/:propertyId/conversations', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { propertyId } = request.params as { propertyId: string };
      const { limit, lastKey } = request.query as QueryParams;

      const conversationsResult = await messagingService.getConversationsForProperty(
        parseInt(propertyId),
        limit ? parseInt(limit) : undefined,
        lastKey ? JSON.parse(lastKey) : undefined
      );

      // Filter conversations to only include those the user is part of
      const userConversations = conversationsResult.conversations.filter(
        (conv: DynamoDBConversation) => conv.participants.includes(userId)
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
  });

  // Get property incidents with conversations
  fastify.get('/property/:propertyId/incidents-with-conversations', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;
      const { propertyId } = request.params as { propertyId: string };

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
            (conv: DynamoDBConversation) => conv.incidentId === incident.id &&
                    conv.conversationType === 'incident_related' &&
                    conv.participants.includes(userId)
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
  });

  // Get unread conversation count for user
  fastify.get('/unread-count', { onRequest: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user;

      // Get all conversations for user
      const result = await messagingService.getConversationsForUser(userId, 100);

      // Count unread messages
      let totalUnread = 0;

      result.conversations.forEach(conversation => {
        const userIdStr = userId.toString();
        if (conversation.unreadCount && conversation.unreadCount[userIdStr]) {
          totalUnread += conversation.unreadCount[userIdStr];
        }
      });

      return {
        unreadCount: totalUnread,
        conversationsWithUnread: result.conversations
          .filter(conv => {
            const userIdStr = userId.toString();
            return conv.unreadCount && conv.unreadCount[userIdStr] > 0;
          })
          .map(conv => ({
            conversationId: conv.conversationId,
            unreadCount: conv.unreadCount[userId.toString()] || 0,
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
  });
}

export default messagingRoutes;
