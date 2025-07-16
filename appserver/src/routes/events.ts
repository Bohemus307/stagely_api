import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EventType, EventCategory } from '../repositories/dynamoDB/eventsRepository';

// Request/Response schemas for Fastify
const eventQuerySchema = {
  type: 'object',
  properties: {
    eventTypes: {
      type: 'array',
      items: { type: 'string' }
    },
    categories: {
      type: 'array',
      items: { type: 'string' }
    },
    startTime: { type: 'number' },
    endTime: { type: 'number' },
    limit: { type: 'number', default: 50 },
    lastEvaluatedKey: { type: 'string' }
  }
};

const eventResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          userId: { type: 'number' },
          eventType: { type: 'string' },
          category: { type: 'string' },
          timestamp: { type: 'number' },
          title: { type: 'string' },
          description: { type: 'string' },
          payload: { type: 'object' },
          metadata: { type: 'object' },
          relatedEntityId: { type: 'string' },
          relatedEntityType: { type: 'string' }
        }
      }
    },
    pagination: {
      type: 'object',
      properties: {
        hasMore: { type: 'boolean' },
        lastEvaluatedKey: { type: 'object' }
      }
    }
  }
};

async function eventRoutes(fastify: FastifyInstance) {
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
      const userId = request.user?.id;
      const query = request.query as any;

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

      const result = await fastify.eventService.getEventsWithFilters(
        userId,
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
      querystring: {
        type: 'object',
        properties: {
          startTime: { type: 'number' },
          endTime: { type: 'number' },
          limit: { type: 'number', default: 50 },
          lastEvaluatedKey: { type: 'string' }
        }
      },
      response: {
        200: eventResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.params as any;
      const query = request.query as any;

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

      const result = await fastify.eventService.getEventsForUser(
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
   * GET /events/type/:eventType
   * Get events by type
   */
  fastify.get('/type/:eventType', {
    schema: {
      tags: ['events'],
      description: 'Get events by type',
      params: {
        type: 'object',
        properties: {
          eventType: { type: 'string' }
        },
        required: ['eventType']
      },
      querystring: {
        type: 'object',
        properties: {
          startTime: { type: 'number' },
          endTime: { type: 'number' },
          limit: { type: 'number', default: 50 },
          lastEvaluatedKey: { type: 'string' }
        }
      },
      response: {
        200: eventResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { eventType } = request.params as any;
      const query = request.query as any;

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

      const result = await fastify.eventService.getEventsByType(
        eventType as EventType,
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
      fastify.log.error('Error fetching events by type:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch events by type'
      });
    }
  });

  /**
   * GET /events/category/:category
   * Get events by category
   */
  fastify.get('/category/:category', {
    schema: {
      tags: ['events'],
      description: 'Get events by category',
      params: {
        type: 'object',
        properties: {
          category: { type: 'string' }
        },
        required: ['category']
      },
      querystring: {
        type: 'object',
        properties: {
          startTime: { type: 'number' },
          endTime: { type: 'number' },
          limit: { type: 'number', default: 50 },
          lastEvaluatedKey: { type: 'string' }
        }
      },
      response: {
        200: eventResponseSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { category } = request.params as any;
      const query = request.query as any;

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

      const result = await fastify.eventService.getEventsByCategory(
        category as EventCategory,
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
      fastify.log.error('Error fetching events by category:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch events by category'
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
      body: {
        type: 'object',
        properties: {
          eventType: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          payload: { type: 'object' },
          metadata: { type: 'object' },
          relatedEntityId: { type: 'string' },
          relatedEntityType: { type: 'string' }
        },
        required: ['eventType', 'title', 'description', 'payload']
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                eventId: { type: 'string' },
                userId: { type: 'number' },
                eventType: { type: 'string' },
                category: { type: 'string' },
                timestamp: { type: 'number' },
                title: { type: 'string' },
                description: { type: 'string' },
                payload: { type: 'object' }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user?.id;
      const body = request.body as any;

      const {
        eventType,
        title,
        description,
        payload,
        metadata,
        relatedEntityId,
        relatedEntityType
      } = body;

      const event = await fastify.eventService.createEvent(
        userId,
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
   * GET /events/types
   * Get all available event types and categories
   */
  fastify.get('/types', {
    schema: {
      tags: ['events'],
      description: 'Get all available event types and categories',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                eventTypes: {
                  type: 'array',
                  items: { type: 'string' }
                },
                categories: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        }
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

  /**
 * GET /events/recent
 * Get recent events for the current user (last 24 hours)
 */
fastify.get('/recent', {
  schema: {
    tags: ['events'],
    description: 'Get recent events for the current user (last 24 hours)',
    summary: 'Get recent events',
    querystring: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20, minimum: 1, maximum: 50 }
      }
    },
    response: {
      200: eventResponseSchema
    }
  }
}, async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const userId = request.user?.id;
    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const query = request.query as any;
    const limit = Math.min(parseInt(query.limit) || 20, 50);

    // Get events from last 24 hours
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

    const result = await fastify.eventService.getEventsForUser(
      userId,
      limit,
      undefined,
      twentyFourHoursAgo
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
    fastify.log.error('Error fetching recent events:', error);
    reply.status(500).send({
      success: false,
      error: 'Failed to fetch recent events'
    });
  }
});

/**
 * POST /events/test
 * Test event creation (for debugging)
 */
fastify.post('/test', {
  schema: {
    tags: ['events'],
    description: 'Test event creation (for debugging)',
    summary: 'Test event creation',
    body: {
      type: 'object',
      properties: {
        eventType: {
          type: 'string',
          enum: Object.values(EventType),
          default: EventType.USER_LOGIN
        },
        title: { type: 'string', default: 'Test Event' },
        description: { type: 'string', default: 'Testing event creation' },
        payload: { type: 'object', default: { test: true } }
      }
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
  try {
    const userId = request.user?.id;
    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const body = request.body as any;
    const {
      eventType = EventType.USER_LOGIN,
      title = 'Test Event',
      description = 'Testing event creation',
      payload = { test: true, timestamp: new Date().toISOString() }
    } = body;

    const metadata = fastify.getEventMetadata(request);

    const event = await fastify.eventService.createEvent(
      userId,
      eventType,
      title,
      description,
      payload,
      metadata
    );

    reply.status(201).send({
      success: true,
      data: event,
      message: 'Event created successfully! Your event store is working.'
    });
  } catch (error) {
    fastify.log.error('Error creating test event:', error);
    reply.status(500).send({
      success: false,
      error: 'Failed to create test event'
    });
  }
});
}

export default eventRoutes;
