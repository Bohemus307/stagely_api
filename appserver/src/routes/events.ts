// src/routes/events.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EventService } from '../services/eventService';
import { DynamoDBEventRepository } from '../repositories/dynamoDB/eventsRepository';
import { UserRepository } from '../repositories/userRepository';
import {
  sendForbidden,
  sendUnauthorized,
} from '../utils/responses';
import eventSchemas from '../schemas/event-schema';

async function eventRoutes(fastify: FastifyInstance) {
  const eventService = new EventService(
    new DynamoDBEventRepository(
      fastify.dynamoDB.documentClient,
      process.env.NODE_ENV || 'staging'
    ),
    new UserRepository(fastify.prisma)
  );

  // Add authentication preHandler
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * GET /events/user/:userId
   * Get events for a specific user with comprehensive date filtering
   * This is the ONLY route needed for the simplified approach
   */
  fastify.get('/user/:userId', {
    schema: {
      tags: ['events'],
      description: 'Get events for a specific user with optional date filtering',
      summary: 'Get user events with date filtering',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'number' }
        },
        required: ['userId']
      },
      querystring: eventSchemas.simpleDateFilterEventQuerySchema,
      response: {
        200: eventSchemas.simplifiedEventsResponseSchema,
        401: eventSchemas.errorResponseSchema,
        403: eventSchemas.errorResponseSchema,
        500: eventSchemas.errorResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.params as any;
      const query = request.query as any;
      const { requestingUserId } = query;

      console.log('🔍 User events request:', {
        targetUserId: userId,
        requestingUserId,
        query
      });

      // Authenticate the requesting user
      const requestingUser = await fastify.prisma.user.findUnique({
        where: { id: requestingUserId }
      });

      if (!requestingUser || requestingUser.auth0Id !== request?.user?.sub) {
        return sendUnauthorized(reply, "User not found or not authorized");
      }

      // Check if requesting user can access target user's events
      // Users should only access their own events
      if (requestingUser.id !== parseInt(userId)) {
        return sendForbidden(reply, "You can only access your own events");
      }

      // Parse query parameters with defaults
      const {
        startTime,
        endTime,
        limit = 50,
        lastEvaluatedKey,
        recent // Special flag for recent events (last 24 hours)
      } = query;

      // Handle time filtering
      let parsedStartTime: number | undefined;
      let parsedEndTime: number | undefined;

      if (recent === 'true' || recent === true) {
        // Get events from last 24 hours
        parsedStartTime = Date.now() - (24 * 60 * 60 * 1000);
        parsedEndTime = undefined; // No end time for recent
      } else {
        parsedStartTime = startTime ? parseInt(startTime as string) : undefined;
        parsedEndTime = endTime ? parseInt(endTime as string) : undefined;
      }

      const parsedLimit = Math.min(parseInt(limit as string), 100); // Cap at 100
      const parsedLastEvaluatedKey = lastEvaluatedKey ? JSON.parse(lastEvaluatedKey as string) : undefined;

      console.log('📊 Parsed query params:', {
        userId: parseInt(userId),
        startTime: parsedStartTime,
        endTime: parsedEndTime,
        limit: parsedLimit,
        recent
      });

      // Use the simple date-filtered method
      const result = await eventService.getEventsForUser(
        parseInt(userId),
        parsedLimit,
        parsedLastEvaluatedKey,
        parsedStartTime,
        parsedEndTime
      );

      console.log('✨ Events result:', {
        eventCount: result.events.length,
        hasMore: !!result.lastEvaluatedKey
      });

      // Set headers to prevent timeout issues
      reply.header('Content-Type', 'application/json');
      reply.header('Connection', 'keep-alive');

      const response = {
        success: true,
        data: result.events,
        pagination: {
          hasMore: !!result.lastEvaluatedKey,
          lastEvaluatedKey: result.lastEvaluatedKey
        },
        filters: {
          startTime: parsedStartTime,
          endTime: parsedEndTime,
          recent: recent === 'true' || recent === true
        }
      };

      return reply.send(response);

    } catch (error) {
      console.error('❌ User events error:', error);
      fastify.log.error('Error fetching user events:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch user events'
      });
    }
  });
}

export default eventRoutes;
