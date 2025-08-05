// src/routes/events.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EventType, EventCategory } from '../repositories/dynamoDB/eventsRepository';
import { EventService } from '../services/eventService';
import { DynamoDBEventRepository } from '../repositories/dynamoDB/eventsRepository';
import { UserRepository } from '../repositories/userRepository';
import {
  sendForbidden,
  sendUnauthorized,
} from '../utils/responses';
import eventSchemas from '../schemas/event-schema';

const eventQuerySchema = eventSchemas.eventQuerySchema;
const eventResponseSchema = eventSchemas.eventsResponseSchema;

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
   * GET /events
   * Get events with optional filtering
   */
  fastify.get('/', {
    schema: {
      tags: ['events'],
      description: 'Get events with optional filtering',
      querystring: eventQuerySchema,
      response: {
        200: eventResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as any;
      const { userId } = query;

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user || user.auth0Id !== request?.user?.sub) {
        return sendUnauthorized(reply, "User not found or not authorized");
      }

      const {
        eventTypes,
        categories,
        startTime,
        endTime,
        limit = 50,
        lastEvaluatedKey
      } = query;

      // Parse query parameters
      const parsedEventTypes = eventTypes ?
        (Array.isArray(eventTypes) ? eventTypes : [eventTypes]).map(type => type as EventType) :
        undefined;

      const parsedCategories = categories ?
        (Array.isArray(categories) ? categories : [categories]).map(cat => cat as EventCategory) :
        undefined;

      const parsedStartTime = startTime ? parseInt(startTime as string) : undefined;
      const parsedEndTime = endTime ? parseInt(endTime as string) : undefined;
      const parsedLimit = parseInt(limit as string);
      const parsedLastEvaluatedKey = lastEvaluatedKey ? JSON.parse(lastEvaluatedKey as string) : undefined;

      const result = await eventService.getEventsWithFilters(
        user.id,
        parsedEventTypes,
        parsedCategories,
        parsedStartTime,
        parsedEndTime,
        parsedLimit,
        parsedLastEvaluatedKey
      );

      reply.send({
        success: true,
        data: result.events,
        pagination: {
          hasMore: !!result.lastEvaluatedKey,
          lastEvaluatedKey: result.lastEvaluatedKey
        }
      });
    } catch (error) {
      fastify.log.error('Error fetching events:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch events'
      });
    }
  });

  /**
   * GET /events/user/:userId
   * Get events for a specific user
   */
  fastify.get('/user/:userId', {
    schema: {
      tags: ['events'],
      description: 'Get events for a specific user',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'number' }
        },
        required: ['userId']
      },
      querystring: eventSchemas.userEventsQuerySchema,
      response: {
        200: eventResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.params as any;
      const query = request.query as any;
      const { requestingUserId } = query;

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

      const {
        startTime,
        endTime,
        limit = 50,
        lastEvaluatedKey
      } = query;

      const parsedStartTime = startTime ? parseInt(startTime as string) : undefined;
      const parsedEndTime = endTime ? parseInt(endTime as string) : undefined;
      const parsedLimit = parseInt(limit as string);
      const parsedLastEvaluatedKey = lastEvaluatedKey ? JSON.parse(lastEvaluatedKey as string) : undefined;

      const result = await eventService.getEventsForUser(
        parseInt(userId),
        parsedLimit,
        parsedLastEvaluatedKey,
        parsedStartTime,
        parsedEndTime
      );

      reply.send({
        success: true,
        data: result.events,
        pagination: {
          hasMore: !!result.lastEvaluatedKey,
          lastEvaluatedKey: result.lastEvaluatedKey
        }
      });
    } catch (error) {
      fastify.log.error('Error fetching user events:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch user events'
      });
    }
  });

  /**
   * POST /events
   * Create a new event manually (for testing or admin purposes)
   */
  fastify.post('/', {
    schema: {
      tags: ['events'],
      description: 'Create a new event manually',
      body: eventSchemas.createEventBodySchema,
      response: {
        201: eventSchemas.eventResponseSchema,
        401: eventSchemas.errorResponseSchema,
        500: eventSchemas.errorResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { userId } = body;

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user || user.auth0Id !== request?.user?.sub) {
        return sendUnauthorized(reply, "User not found or not authorized");
      }

      const {
        eventType,
        title,
        description,
        payload,
        metadata,
        relatedEntityId,
        relatedEntityType
      } = body;

      const event = await eventService.createEvent(
        user.id,
        eventType,
        title,
        description,
        payload,
        metadata,
        relatedEntityId,
        relatedEntityType
      );

      reply.status(201).send({
        success: true,
        data: event
      });
    } catch (error) {
      fastify.log.error('Error creating event:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to create event'
      });
    }
  });


  /**
 * GET /events/recent
 * Get recent events for the current user (last 24 hours)
 */
fastify.get('/recent', {
  schema: {
    tags: ['events'],
    description: 'Get recent events for the current user (last 24 hours)',
    summary: 'Get recent events',
    querystring: eventSchemas.recentEventsQuerySchema,
    response: {
      200: eventResponseSchema
    }
  }
}, async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = request.query as any;
    const { userId } = query;

    console.log('🔍 Recent events request:', { userId, query });

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.auth0Id !== request?.user?.sub) {
      return sendUnauthorized(reply, "User not found or not authorized");
    }

    const limit = Math.min(parseInt(query.limit) || 20, 50);

    // Get events from last 24 hours
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

    console.log('📊 Query params:', {
      userId: user.id,
      limit,
      twentyFourHoursAgo,
      currentTime: Date.now()
    });

    const result = await eventService.getEventsForUser(
      user.id,
      limit,
      undefined,
      twentyFourHoursAgo
    );

    console.log('✨ Events result:', {
      eventCount: result.events.length,
      hasMore: !!result.lastEvaluatedKey
    });

    // 🚀 ADD THESE LINES: Set headers before sending to prevent timeout issues
    reply.header('Content-Type', 'application/json');
    reply.header('Connection', 'keep-alive');

    console.log('📤 About to send response with', result.events.length, 'events');

    // Create the response object
    const response = {
      success: true,
      data: result.events,
      pagination: {
        hasMore: !!result.lastEvaluatedKey,
        lastEvaluatedKey: result.lastEvaluatedKey
      }
    };

    // 🚀 CHANGE THIS: Use return instead of direct reply.send()
    return reply.send(response);

  } catch (error) {
    console.error('❌ Recent events error:', error);
    fastify.log.error('Error fetching recent events:', error);
    reply.status(500).send({
      success: false,
      error: 'Failed to fetch recent events'
    });
  }
});

  /**
   * GET /events/types
   * Get all available event types and categories (no auth required)
   */
  fastify.get('/types', {
    schema: {
      tags: ['events'],
      description: 'Get all available event types and categories',
      response: {
        200: eventSchemas.eventTypesResponseSchema,
        500: eventSchemas.errorResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const eventTypes = Object.values(EventType);
      const categories = Object.values(EventCategory);

      reply.send({
        success: true,
        data: {
          eventTypes,
          categories
        }
      });
    } catch (error) {
      fastify.log.error('Error fetching event types:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch event types'
      });
    }
  });

}

export default eventRoutes;
