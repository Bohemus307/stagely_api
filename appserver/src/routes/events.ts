// src/routes/events.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EventType, EventCategory } from '../repositories/dynamoDB/eventsRepository';
import { EventService } from '../services/eventService';
import { DynamoDBEventRepository } from '../repositories/dynamoDB/eventsRepository';
import { UserRepository } from '../repositories/userRepository';
import { getEventMetadata } from '../utils/eventHelpers';
import { sendNotFound } from '../utils/responses';

async function eventRoutes(fastify: FastifyInstance) {
  const eventService = new EventService(
    new DynamoDBEventRepository(
      fastify.dynamoDB.documentClient,
      process.env.NODE_ENV || 'staging'
    ),
    new UserRepository(fastify.prisma)
  );

  // ===========================================
  // INTERNAL MOBILE PERFORMANCE ROUTES
  //
  // ===========================================

  /**
   * GET /events/types 
   */
  fastify.get('/types', {
    schema: {
      tags: ['events'],
      description: 'Get all available event types and categories',
      summary: 'Get event types and categories',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                eventTypes: { type: 'array', items: { type: 'string' } },
                categories: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const eventTypes = Object.values(EventType);
    const categories = Object.values(EventCategory);

    reply.send({
      success: true,
      data: { eventTypes, categories }
    });
  });

  /**
   * POST /events/test - Development testing (no auth)
   */
  fastify.post('/test', {
    schema: {
      tags: ['events'],
      description: 'Test event creation (for debugging)',
      summary: 'Test event creation',
      body: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'User ID for test event' },
          eventType: { type: 'string', enum: Object.values(EventType), default: 'property_viewed' },
          title: { type: 'string', default: 'Test Event' },
          description: { type: 'string', default: 'Testing event creation' },
          payload: { type: 'object', default: { test: true } }
        },
        required: ['userId']
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      userId,
      eventType = 'property_viewed',
      title = 'Test Event',
      description = 'Testing event creation',
      payload = { test: true, timestamp: new Date().toISOString() }
    } = request.body as any;

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return sendNotFound(reply, 'User not found');
    }

    const metadata = getEventMetadata(request);
    const event = await eventService.createEvent(
      user.id, eventType, title, description, payload, metadata
    );

    reply.status(201).send({
      success: true,
      data: event,
      message: 'Test event created successfully!'
    });
  });

  /**
   * GET /events/recent - Mobile performance route
   */
  fastify.get('/recent', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['events'],
      description: 'Get recent events for performance optimization',
      summary: 'Get recent events',
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'User ID' },
          limit: { type: 'number', default: 20, minimum: 1, maximum: 50 }
        },
        required: ['userId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            pagination: { type: 'object' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, limit = 20 } = request.query as any;

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return sendNotFound(reply, 'User not found');
    }

    const parsedLimit = Math.min(parseInt(limit), 50);
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

    const result = await eventService.getEventsForUser(
      user.id, parsedLimit, undefined, twentyFourHoursAgo
    );

    reply.send({
      success: true,
      data: result.events,
      pagination: {
        hasMore: !!result.lastEvaluatedKey,
        lastEvaluatedKey: result.lastEvaluatedKey,
        count: result.events.length
      }
    });
  });

  /**
   * GET /events - Mobile performance route with filters
   * For analytics, caching, prefetching decisions
   */
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['events'],
      description: 'Get events with filtering for mobile optimization',
      summary: 'Get filtered events',
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'number' },
          eventTypes: { type: 'array', items: { type: 'string' } },
          categories: { type: 'array', items: { type: 'string' } },
          startTime: { type: 'number' },
          endTime: { type: 'number' },
          limit: { type: 'number', default: 50, minimum: 1, maximum: 100 },
          lastEvaluatedKey: { type: 'string' }
        },
        required: ['userId']
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      userId, eventTypes, categories, startTime, endTime, limit = 50, lastEvaluatedKey
    } = request.query as any;

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return sendNotFound(reply, 'User not found');
    }

    const parsedEventTypes = eventTypes ?
      (Array.isArray(eventTypes) ? eventTypes : [eventTypes]).map(type => type as EventType) :
      undefined;

    const parsedCategories = categories ?
      (Array.isArray(categories) ? categories : [categories]).map(cat => cat as EventCategory) :
      undefined;

    const result = await eventService.getEventsWithFilters(
      user.id,
      parsedEventTypes,
      parsedCategories,
      startTime ? parseInt(startTime) : undefined,
      endTime ? parseInt(endTime) : undefined,
      Math.min(parseInt(limit), 100),
      lastEvaluatedKey ? JSON.parse(lastEvaluatedKey) : undefined
    );

    reply.send({
      success: true,
      data: result.events,
      pagination: {
        hasMore: !!result.lastEvaluatedKey,
        lastEvaluatedKey: result.lastEvaluatedKey,
        count: result.events.length
      }
    });
  });

  /**
   * POST /events - Create performance tracking events
   * Mobile app logs user actions for optimization
   */
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['events'],
      description: 'Create performance tracking event',
      summary: 'Create event',
      body: {
        type: 'object',
        properties: {
          userId: { type: 'number' },
          eventType: { type: 'string', enum: Object.values(EventType) },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          payload: { type: 'object' },
          metadata: { type: 'object' },
          relatedEntityId: { type: 'string' },
          relatedEntityType: { type: 'string', enum: ['property', 'incident', 'inspection', 'user'] }
        },
        required: ['userId', 'eventType', 'title', 'description', 'payload']
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      userId, eventType, title, description, payload, metadata, relatedEntityId, relatedEntityType
    } = request.body as any;

    // SIMPLIFIED: Just verify user exists
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return sendNotFound(reply, 'User not found');
    }

    const event = await eventService.createEvent(
      user.id, eventType, title, description, payload, metadata, relatedEntityId, relatedEntityType
    );

    reply.status(201).send({
      success: true,
      data: event,
      message: 'Event created successfully'
    });
  });

  /**
   * GET /events/user/:userId - Mobile app background processing
   * Might need to access different users for sync, caching, etc.
   */
  fastify.get('/user/:userId', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['events'],
      description: 'Get events for any user (mobile performance)',
      summary: 'Get user events',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'number' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          startTime: { type: 'number' },
          endTime: { type: 'number' },
          limit: { type: 'number', default: 50 },
          lastEvaluatedKey: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as any;
    const { startTime, endTime, limit = 50, lastEvaluatedKey } = request.query as any;

    // SIMPLIFIED: Just verify user exists, no ownership validation
    const user = await fastify.prisma.user.findUnique({
      where: { id: parseInt(userId) }
    });

    if (!user) {
      return sendNotFound(reply, 'User not found');
    }

    const result = await eventService.getEventsForUser(
      parseInt(userId),
      Math.min(parseInt(limit), 100),
      lastEvaluatedKey ? JSON.parse(lastEvaluatedKey) : undefined,
      startTime ? parseInt(startTime) : undefined,
      endTime ? parseInt(endTime) : undefined
    );

    reply.send({
      success: true,
      data: result.events,
      pagination: {
        hasMore: !!result.lastEvaluatedKey,
        lastEvaluatedKey: result.lastEvaluatedKey,
        count: result.events.length
      }
    });
  });
}

export default eventRoutes;
