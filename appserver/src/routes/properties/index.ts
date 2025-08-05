import { FastifyInstance } from "fastify";
import { PropertyStatus } from "@prisma/client";
import { NotFoundError } from "../../utils/errors";
import {
  sendNotFound,
  sendConflict,
  sendUnauthorized,
} from "../../utils/responses";
import {
  propertiesResponseSchema,
  propertyResponseSchema,
  createPropertySchema,
  updatePropertySchema,
} from "../../schemas/property-schema";
import { PropertyService } from "../../services/properties";
import { EventService } from "../../services/eventService";
import { DynamoDBEventRepository } from "../../repositories/dynamoDB/eventsRepository";
import { UserRepository } from "../../repositories/userRepository";
import { getEventMetadata, getChangedFields } from "../../utils/eventHelpers";

// Define route parameter types
interface ParamsWithId {
  id: string;
}

interface StatusUpdateBody {
  status: PropertyStatus;
}

/**
 * Property routes
 *
 * @param fastify - The Fastify instance
 * @param options - Route options
 */
async function propertyRoutes(fastify: FastifyInstance): Promise<void> {
  // Get service instance with Prisma
  const propertyService = new PropertyService(fastify.prisma);

  const eventService = new EventService(
        new DynamoDBEventRepository(
            fastify.dynamoDB.documentClient,
            process.env.NODE_ENV || 'staging'
        ),
        new UserRepository(fastify.prisma)
    );

  // GET /properties/search
  fastify.route({
    method: "GET",
    url: "/search",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Search for properties by address, city, country, etc.",
      summary: "Search properties",
      querystring: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (optional)",
          },
          page: {
            type: "integer",
            minimum: 1,
            default: 1,
            description: "Page number",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 10,
            description: "Number of items per page",
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
                  id: { type: "integer" },
                  address: { type: "string" },
                  city: { type: "string" },
                  state: { type: "string", nullable: true },
                  country: { type: "string" },
                  zipCode: { type: "string", nullable: true },
                  status: {
                    type: "string",
                    enum: Object.values(PropertyStatus),
                  },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                  _count: {
                    type: "object",
                    properties: {
                      incidents: { type: "integer" },
                      inspections: { type: "integer" },
                      spaces: { type: "integer" },
                    },
                  },
                },
              },
            },
            meta: {
              type: "object",
              properties: {
                page: { type: "integer" },
                limit: { type: "integer" },
                total: { type: "integer" },
                totalPages: { type: "integer" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { query, page, limit } = request.query as {
        query?: string;
        page?: string;
        limit?: string;
      };

      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // Search for properties, restricting to those owned by the current user
      const results = await propertyService.searchProperties(
        query,
        user.id,
        page ? parseInt(page) : undefined,
        limit ? parseInt(limit) : undefined,
      );

      return results;
    },
  });

  // GET /properties
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Get a list of properties with optional filtering",
      summary: "List all properties",
      querystring: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            minimum: 1,
            default: 1,
            description: "Page number",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 10,
            description: "Number of items per page",
          },
          status: {
            type: "string",
            enum: Object.values(PropertyStatus),
            description: "Filter by property status",
          },
          country: { type: "string", description: "Filter by country" },
          city: { type: "string", description: "Filter by city" },
          sortBy: {
            type: "string",
            enum: ["createdAt", "updatedAt", "address"],
            default: "updatedAt",
            description: "Sort results by field",
          },
          sortOrder: {
            type: "string",
            enum: ["asc", "desc"],
            default: "desc",
            description: "Sort order (ascending or descending)",
          },
          search: {
            type: "string",
            description: "Search term for property address or location",
          },
        },
      },
      response: {
        200: propertiesResponseSchema,
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // Add userId to query params
      const queryParams = {
        ...(request.query as any),
        userId: user.id,
      };

      const result = await propertyService.getProperties(queryParams);

      return result;
    },
  });

  // GET /properties/:id
  fastify.route({
    method: "GET",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Get a single property by ID",
      summary: "Get property details",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Property ID" },
        },
        required: ["id"],
      },
      response: {
        200: propertyResponseSchema,
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
      const { id } = request.params as ParamsWithId;

      try {
        const property = await propertyService.getPropertyById(parseInt(id));
        const startTime = Date.now();
        const duration = Date.now() - startTime;

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this property",
          );
        }

        // Log property viewed
        setImmediate(async () => {
      try {
        await eventService.logPropertyViewed(
          user.id,
          property.id,
          property.address,
          getEventMetadata(request)
        );
      } catch (error) {
        fastify.log.error('Failed to log property view:', error);
      }
    });

        return property;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // POST /properties
  fastify.route({
    method: "POST",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Create a new property",
      summary: "Create property",
      body: createPropertySchema,
      response: {
        201: propertyResponseSchema,
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: {
                  type: "string",
                  example: "A property with this address already exists",
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
        // Get the user from the database based on Auth0 ID
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const property = await propertyService.createProperty(
          request.body as any,
          user.id,
        );

        reply.code(201);
        return property;
      } catch (err: any) {
        // Handle specific errors with appropriate status codes
        fastify.log.error(err);

        if (err.code === "P2002") {
          return sendConflict(
            reply,
            "A property with this address already exists",
          );
        }

        throw err;
      }
    },
  });

  // PUT /properties/:id
  fastify.route({
    method: "PUT",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Update an existing property",
      summary: "Update property",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Property ID" },
        },
        required: ["id"],
      },
      body: updatePropertySchema,
      response: {
        200: propertyResponseSchema,
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
      const { id } = request.params as ParamsWithId;

      try {
        // First check if property exists
        const existingProperty = await propertyService.getPropertyById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user || existingProperty.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to update this property",
          );
        }

        const updateData = request.body as any;
        const property = await propertyService.updateProperty(
          parseInt(id),
          updateData,
        );
        //log property updated
        setImmediate(async () => {
          try {
            const changedFields = getChangedFields(existingProperty, property);

            if (changedFields.length > 0) {
              await eventService.logPropertyUpdated(
                user.id,
                parseInt(id),
                `${property.address}, ${property.city}`,
                changedFields,
                getEventMetadata(request)
              );
            }
          } catch (error) {
            fastify.log.error('Failed to log property updated event:', error);
          }
        });

        return property;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // PATCH /properties/:id/status
  fastify.route({
    method: "PATCH",
    url: "/:id/status",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Update property status",
      summary: "Change property status",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Property ID" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: Object.values(PropertyStatus),
            description: "New property status",
          },
        },
        required: ["status"],
      },
      response: {
        200: propertyResponseSchema,
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
      const { id } = request.params as ParamsWithId;
      const { status } = request.body as StatusUpdateBody;

      try {
        // First check if property exists
        const existingProperty = await propertyService.getPropertyById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user || existingProperty.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to update this property",
          );
        }

        const property = await propertyService.changePropertyStatus(
          parseInt(id),
          status,
        );

        // Log property status change
        setImmediate(async () => {
          try {
            // Log general status change event
            await eventService.logPropertyStatusChanged(
              user.id,
              property.id,
              `${property.address}, ${property.city}`,
              existingProperty.status,
              status,
              getEventMetadata(request)
            );

          } catch (error) {
            fastify.log.error('Failed to log property status change events:', error);
          }
        });

        return property;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // DELETE /properties/:id
  fastify.route({
    method: "DELETE",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Delete a property",
      summary: "Delete property",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Property ID" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            id: { type: "integer", example: 123 },
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
      const { id } = request.params as ParamsWithId;

      try {
        // First check if property exists
        const existingProperty = await propertyService.getPropertyById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user || existingProperty.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to delete this property",
          );
        }

        await propertyService.deleteProperty(parseInt(id));

        return { success: true, id: parseInt(id) };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // GET /properties/stats
  fastify.route({
    method: "GET",
    url: "/stats",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Get statistics about user properties",
      summary: "Property statistics",
      response: {
        200: {
          type: "object",
          properties: {
            totalProperties: { type: "integer", example: 10 },
            activeProperties: { type: "integer", example: 7 },
            maintenanceProperties: { type: "integer", example: 2 },
            archivedProperties: { type: "integer", example: 1 },
            totalIncidents: { type: "integer", example: 15 },
            openIncidents: { type: "integer", example: 3 },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      const stats = await propertyService.getUserPropertyStats(user.id);

      // Log property stats viewed
      setImmediate(async () => {
        try {
          await eventService.logPropertyStatsViewed(
            user.id,
            stats.totalProperties,
            stats.activeProperties,
            stats.totalIncidents,
            getEventMetadata(request)
          );
        } catch (error) {
          fastify.log.error('Failed to log property stats viewed:', error);
        }
      });

      return stats;
    },
  });

  // Additional routes for spaces, inspections, and incidents

  // GET /properties/:id/spaces
  fastify.route({
    method: "GET",
    url: "/:id/spaces",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Get spaces for a property",
      summary: "Get property spaces",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Property ID" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
              type: { type: "string" },
              aiGenerated: { type: "boolean" },
              confidenceScore: { type: "number" },
              images: {
                type: "array",
                items: {
                  type: "object",
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
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        // First check if property exists
        const existingProperty = await propertyService.getPropertyById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user || existingProperty.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this property",
          );
        }

        const spaces = await propertyService.getPropertySpaces(parseInt(id));

        return spaces;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // GET /properties/:id/inspections
  fastify.route({
    method: "GET",
    url: "/:id/inspections",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Get inspections for a property",
      summary: "Get property inspections",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Property ID" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              title: { type: "string" },
              description: { type: "string" },
              inspectionDate: { type: "string", format: "date-time" },
              photos: {
                type: "array",
                items: {
                  type: "object",
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
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        // First check if property exists
        const existingProperty = await propertyService.getPropertyById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user || existingProperty.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this property",
          );
        }

        const inspections = await propertyService.getPropertyInspections(
          parseInt(id),
        );

        return inspections;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // GET /properties/:id/incidents
  fastify.route({
    method: "GET",
    url: "/:id/incidents",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["properties"],
      description: "Get incidents for a property",
      summary: "Get property incidents",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Property ID" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              incidentType: { type: "string" },
              description: { type: "string" },
              reportedAt: { type: "string", format: "date-time" },
              resolvedAt: { type: "string", format: "date-time" },
              severity: { type: "string" },
              status: { type: "string" },
              images: {
                type: "array",
                items: {
                  type: "object",
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
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        // First check if property exists
        const existingProperty = await propertyService.getPropertyById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user || existingProperty.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this property",
          );
        }

        const incidents = await propertyService.getPropertyIncidents(
          parseInt(id),
        );

        return incidents;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });
}

export default propertyRoutes;
