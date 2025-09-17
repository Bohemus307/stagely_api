import { sendNotFound, sendUnauthorized } from "../../utils/responses";
import { DynamoDBEventRepository } from "../../repositories/dynamoDB/eventsRepository";
import { FastifyInstance } from "fastify";

// Define route parameter types
interface ParamsWithId {
  id: string;
}

interface ParamsWithEntityId {
  entityId: string;
}

interface EventQueryParams {
  page?: string;
  limit?: string;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  lastEvaluatedKey?: string;
}

/**
 * Event routes for activity feed
 *
 * @param fastify - The Fastify instance
 */
async function eventRoutes(fastify: FastifyInstance): Promise<void> {
  // Initialize event repository with DynamoDB document client
  const eventRepo = new DynamoDBEventRepository(
    fastify.dynamoDB.documentClient,
    "staging",
  );

  // GET /events
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["events"],
      description: "Get user's activity events with filtering and pagination",
      summary: "List user events",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
            description: "Number of events per page",
          },
          eventType: {
            type: "string",
            description:
              "Filter by event type (e.g., property.created, incident.resolved)",
          },
          entityType: {
            type: "string",
            enum: ["property", "incident", "inspection"],
            description: "Filter by entity type",
          },
          entityId: {
            type: "string",
            description: "Filter by specific entity ID",
          },
          startDate: {
            type: "string",
            format: "date-time",
            description: "Filter events after this date",
          },
          endDate: {
            type: "string",
            format: "date-time",
            description: "Filter events before this date",
          },
          lastEvaluatedKey: {
            type: "string",
            description: "Pagination cursor from previous response",
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  eventId: { type: "string" },
                  eventType: { type: "string" },
                  timestamp: { type: "number" },
                  entityId: { type: "string", nullable: true },
                  entityType: { type: "string", nullable: true },
                  metadata: {
                    type: "object",
                    additionalProperties: true,
                  },
                  source: { type: "string" },
                  datePartition: { type: "string" },
                },
              },
            },
            meta: {
              type: "object",
              properties: {
                limit: { type: "integer" },
                hasMore: { type: "boolean" },
                lastEvaluatedKey: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const {
        limit = "20",
        eventType,
        entityType,
        entityId,
        startDate,
        endDate,
        lastEvaluatedKey,
      } = request.query as EventQueryParams;

      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // Convert date strings to timestamps if provided
      const startTime = startDate ? new Date(startDate).getTime() : undefined;
      const endTime = endDate ? new Date(endDate).getTime() : undefined;

      // Parse lastEvaluatedKey if provided
      let parsedLastKey;
      if (lastEvaluatedKey) {
        try {
          parsedLastKey = JSON.parse(lastEvaluatedKey);
        } catch (e) {
          // Invalid cursor, ignore
        }
      }

      // Get events for the user
      const result = await eventRepo.getUserEvents(
        user.id,
        startTime,
        endTime,
        parseInt(limit),
        parsedLastKey,
      );

      // Apply additional filters if specified
      let filteredEvents = result.events;

      if (eventType) {
        filteredEvents = filteredEvents.filter(
          (e) => e.eventType === eventType,
        );
      }

      if (entityType) {
        filteredEvents = filteredEvents.filter(
          (e) => e.entityType === entityType,
        );
      }

      if (entityId) {
        filteredEvents = filteredEvents.filter((e) => e.entityId === entityId);
      }

      return {
        data: filteredEvents,
        meta: {
          limit: parseInt(limit),
          hasMore: !!result.lastEvaluatedKey,
          lastEvaluatedKey: result.lastEvaluatedKey
            ? JSON.stringify(result.lastEvaluatedKey)
            : null,
        },
      };
    },
  });

  // GET /events/property/:entityId
  fastify.route({
    method: "GET",
    url: "/property/:entityId",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["events"],
      description: "Get all events for a specific property",
      summary: "Get property events",
      params: {
        type: "object",
        properties: {
          entityId: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property ID",
          },
        },
        required: ["entityId"],
      },
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 50,
            description: "Number of events to retrieve",
          },
          startDate: {
            type: "string",
            format: "date-time",
            description: "Filter events after this date",
          },
          endDate: {
            type: "string",
            format: "date-time",
            description: "Filter events before this date",
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  eventId: { type: "string" },
                  eventType: { type: "string" },
                  timestamp: { type: "number" },
                  userId: { type: "number", nullable: true },
                  metadata: { type: "object" },
                  source: { type: "string" },
                  datePartition: { type: "string" },
                },
              },
            },
            property: {
              type: "object",
              properties: {
                id: { type: "integer" },
                address: { type: "string" },
                city: { type: "string" },
                state: { type: "string", nullable: true },
              },
            },
          },
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { entityId } = request.params as ParamsWithEntityId;
      const {
        limit = "50",
        startDate,
        endDate,
      } = request.query as EventQueryParams;

      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // Verify property exists and belongs to user
      const property = await fastify.prisma.property.findUnique({
        where: { id: parseInt(entityId) },
        select: {
          id: true,
          userId: true,
          address: true,
          city: true,
          state: true,
        },
      });

      if (!property) {
        return sendNotFound(reply, "Property not found");
      }

      if (property.userId !== user.id) {
        return sendUnauthorized(
          reply,
          "You don't have permission to view this property's events",
        );
      }

      // Convert date strings to timestamps
      const startTime = startDate ? new Date(startDate).getTime() : undefined;
      const endTime = endDate ? new Date(endDate).getTime() : undefined;

      // Get events for this property
      const result = await eventRepo.getEntityEvents(
        entityId,
        startTime,
        endTime,
        parseInt(limit),
      );

      return {
        data: result.events,
        property: {
          id: property.id,
          address: property.address,
          city: property.city,
          state: property.state,
        },
      };
    },
  });

  // GET /events/incident/:entityId
  fastify.route({
    method: "GET",
    url: "/incident/:entityId",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["events"],
      description: "Get all events for a specific incident",
      summary: "Get incident events",
      params: {
        type: "object",
        properties: {
          entityId: {
            type: "string",
            pattern: "^\\d+$",
            description: "Incident ID",
          },
        },
        required: ["entityId"],
      },
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 50,
            description: "Number of events to retrieve",
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  eventId: { type: "string" },
                  eventType: { type: "string" },
                  timestamp: { type: "number" },
                  userId: { type: "number", nullable: true },
                  metadata: { type: "object" },
                  source: { type: "string" },
                  datePartition: { type: "string" },
                },
              },
            },
          },
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Incident not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { entityId } = request.params as ParamsWithEntityId;
      const { limit = "50" } = request.query as EventQueryParams;

      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // Verify incident exists and belongs to user through property ownership
      const incident = await fastify.prisma.incident.findUnique({
        where: { id: parseInt(entityId) },
        include: {
          property: {
            select: {
              userId: true,
            },
          },
        },
      });

      if (!incident) {
        return sendNotFound(reply, "Incident not found");
      }

      if (incident.property.userId !== user.id) {
        return sendUnauthorized(
          reply,
          "You don't have permission to view this incident's events",
        );
      }

      // Get events for this incident
      const result = await eventRepo.getEntityEvents(
        entityId,
        undefined,
        undefined,
        parseInt(limit),
      );

      return {
        data: result.events,
      };
    },
  });

  // GET /events/:id
  fastify.route({
    method: "GET",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["events"],
      description: "Get a specific event by ID",
      summary: "Get event details",
      params: {
        type: "object",
        properties: {
          id: { type: "string", description: "Event ID" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            eventId: { type: "string" },
            eventType: { type: "string" },
            timestamp: { type: "number" },
            userId: { type: "number", nullable: true },
            entityId: { type: "string", nullable: true },
            entityType: { type: "string", nullable: true },
            datePartition: { type: "string" },
            metadata: { type: "object" },
            source: { type: "string" },
            version: { type: "string" },
            ttl: { type: "number", nullable: true },
          },
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Event not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      const event = await eventRepo.getEvent(id);

      if (!event) {
        return sendNotFound(reply, "Event not found");
      }

      // Verify event belongs to user
      if (event.userId !== user.id) {
        return sendUnauthorized(
          reply,
          "You don't have permission to view this event",
        );
      }

      return event;
    },
  });

  // GET /events/date/:date
  fastify.route({
    method: "GET",
    url: "/date/:date",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["events"],
      description: "Get events for a specific date",
      summary: "Get events by date",
      params: {
        type: "object",
        properties: {
          date: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Date in YYYY-MM-DD format",
          },
        },
        required: ["date"],
      },
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 100,
            description: "Number of events to retrieve",
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  eventId: { type: "string" },
                  eventType: { type: "string" },
                  timestamp: { type: "number" },
                  entityId: { type: "string", nullable: true },
                  entityType: { type: "string", nullable: true },
                  metadata: { type: "object" },
                  source: { type: "string" },
                },
              },
            },
            meta: {
              type: "object",
              properties: {
                date: { type: "string" },
                count: { type: "integer" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { date } = request.params as { date: string };
      const { limit = "100" } = request.query as EventQueryParams;

      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // Get all events for the date
      const result = await eventRepo.getEventsByDate(
        date,
        undefined,
        undefined,
        parseInt(limit),
      );

      // Filter to only user's events
      const userEvents = result.events.filter(
        (event) => event.userId === user.id,
      );

      return {
        data: userEvents,
        meta: {
          date,
          count: userEvents.length,
        },
      };
    },
  });
}

export default eventRoutes;
