import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PropertyStatus } from "@prisma/client";
import { NotFoundError, UnauthorizedError } from "../../utils/errors";
import { PropertyService } from "../../services/properties";
import {
  sendUnauthorized,
  sendNotFound,
  sendForbidden,
  sendConflict,
} from "../../utils/responses";
import {
  propertiesResponseSchema,
  propertyResponseSchema,
  createPropertySchema,
  updatePropertySchema,
} from "../../schemas/property-schema";

// Define route parameter types
interface ParamsWithId {
  id: string;
}

interface StatusUpdateBody {
  status: PropertyStatus;
}

// Define user JWT payload type
interface JwtUser {
  userId: number;
  role: string;
}

// Declare jwt for fastify request
declare module "fastify" {
  interface FastifyRequest {
    user: JwtUser;
  }
}

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

/**
 * Property routes
 *
 * @param fastify - The Fastify instance
 * @param options - Route options
 */
async function propertyRoutes(fastify: FastifyInstance): Promise<void> {
  // Get service instance with Prisma
  const propertyService = new PropertyService(fastify.prisma);

  // GET /properties
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: authenticate,
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
        },
      },
      response: {
        200: propertiesResponseSchema,
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const userId = request.user.userId;
      const isAdmin = request.user.role === "admin";

      // If not admin, add filter to only show user's properties
      const queryParams = { ...(request.query as object) };
      if (!isAdmin) {
        (queryParams as any).userId = userId;
      }

      const result = await propertyService.getProperties(queryParams as any);
      return result;
    },
  });

  // GET /properties/:id
  fastify.route({
    method: "GET",
    url: "/:id",
    onRequest: authenticate,
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
        403: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 403 },
                message: { type: "string", example: "Access denied" },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const userId = request.user.userId;
      const isAdmin = request.user.role === "admin";

      try {
        const property = await propertyService.getPropertyById(
          parseInt(id),
          userId,
          isAdmin,
        );
        return property;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        if (err instanceof UnauthorizedError) {
          return sendForbidden(reply, err.message);
        }
        throw err;
      }
    },
  });

  // POST /properties
  fastify.route({
    method: "POST",
    url: "/",
    onRequest: authenticate,
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
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const userId = request.user.userId;

      try {
        const property = await propertyService.createProperty(
          request.body as any,
          userId,
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
    onRequest: authenticate,
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
        403: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 403 },
                message: { type: "string", example: "Access denied" },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const userId = request.user.userId;
      const isAdmin = request.user.role === "admin";

      try {
        const property = await propertyService.updateProperty(
          parseInt(id),
          request.body as any,
          userId,
          isAdmin,
        );

        return property;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        if (err instanceof UnauthorizedError) {
          return sendForbidden(reply, err.message);
        }
        throw err;
      }
    },
  });

  // PATCH /properties/:id/status
  fastify.route({
    method: "PATCH",
    url: "/:id/status",
    onRequest: authenticate,
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
        403: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 403 },
                message: { type: "string", example: "Access denied" },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const { status } = request.body as StatusUpdateBody;
      const userId = request.user.userId;
      const isAdmin = request.user.role === "admin";

      try {
        const property = await propertyService.changePropertyStatus(
          parseInt(id),
          status,
          userId,
          isAdmin,
        );

        return property;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        if (err instanceof UnauthorizedError) {
          return sendForbidden(reply, err.message);
        }
        throw err;
      }
    },
  });

  // DELETE /properties/:id
  fastify.route({
    method: "DELETE",
    url: "/:id",
    onRequest: authenticate,
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
        403: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 403 },
                message: { type: "string", example: "Access denied" },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const userId = request.user.userId;
      const isAdmin = request.user.role === "admin";

      try {
        await propertyService.deleteProperty(parseInt(id), userId, isAdmin);

        return { success: true, id: parseInt(id) };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        if (err instanceof UnauthorizedError) {
          return sendForbidden(reply, err.message);
        }
        throw err;
      }
    },
  });

  // GET /properties/stats
  fastify.route({
    method: "GET",
    url: "/stats",
    onRequest: authenticate,
    schema: {
      tags: ["properties"],
      description: "Get statistics about user properties",
      summary: "Property statistics",
      response: {
        200: {
          type: "object",
          properties: {
            propertiesByStatus: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  status: { type: "string", example: "ACTIVE" },
                  _count: { type: "integer", example: 5 },
                },
              },
            },
            openIncidentsCount: { type: "integer", example: 3 },
            recentIncidents: {
              type: "array",
              items: {
                type: "object",
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const userId = request.user.userId;
      const stats = await propertyService.getUserPropertyStats(userId);
      return stats;
    },
  });
}

export default propertyRoutes;
