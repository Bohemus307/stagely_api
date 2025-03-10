import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PropertyStatus } from "@prisma/client";
import { NotFoundError, UnauthorizedError } from "../utils/errors";
import { PropertyService } from "../services/properties";

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
 * Helper functions for sending standardized error responses
 */
function sendNotFound(
  reply: FastifyReply,
  message: string = "Resource not found",
) {
  return reply.code(404).send({ error: "Not Found", message });
}

function sendForbidden(
  reply: FastifyReply,
  message: string = "Access forbidden",
) {
  return reply.code(403).send({ error: "Forbidden", message });
}

function sendUnauthorized(
  reply: FastifyReply,
  message: string = "Authentication required",
) {
  return reply.code(401).send({ error: "Unauthorized", message });
}

function sendConflict(
  reply: FastifyReply,
  message: string = "Resource conflict",
) {
  return reply.code(409).send({ error: "Conflict", message });
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
async function propertyRoutes(
  fastify: FastifyInstance,
  options: object,
): Promise<void> {
  // Get service instance with Prisma
  const propertyService = new PropertyService(fastify.prisma);

  // Load schemas (define them in a separate file)
  const {
    createPropertySchema,
    updatePropertySchema,
    propertyResponseSchema,
    propertiesResponseSchema,
  } = require("../schemas/property-schemas");

  // GET /properties
  fastify.get("/", {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
          status: { type: "string", enum: Object.values(PropertyStatus) },
          country: { type: "string" },
          city: { type: "string" },
          sortBy: {
            type: "string",
            enum: ["createdAt", "updatedAt", "address"],
            default: "updatedAt",
          },
          sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        },
      },
      response: {
        200: propertiesResponseSchema,
      },
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
  fastify.get<{ Params: ParamsWithId }>("/:id", {
    preHandler: authenticate,
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$" },
        },
        required: ["id"],
      },
      response: {
        200: propertyResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
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
  fastify.post("/", {
    preHandler: authenticate,
    schema: {
      body: createPropertySchema,
      response: {
        201: propertyResponseSchema,
      },
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
  fastify.put<{ Params: ParamsWithId }>("/:id", {
    preHandler: authenticate,
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$" },
        },
        required: ["id"],
      },
      body: updatePropertySchema,
      response: {
        200: propertyResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
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
  fastify.patch<{ Params: ParamsWithId; Body: StatusUpdateBody }>(
    "/:id/status",
    {
      preHandler: authenticate,
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^\\d+$" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            status: { type: "string", enum: Object.values(PropertyStatus) },
          },
          required: ["status"],
        },
        response: {
          200: propertyResponseSchema,
        },
      },

      handler: async (request, reply) => {
        const { id } = request.params;
        const { status } = request.body;
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
    },
  );

  // DELETE /properties/:id
  fastify.delete<{ Params: ParamsWithId }>("/:id", {
    preHandler: authenticate,
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            id: { type: "integer" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
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
  fastify.get("/stats", {
    preHandler: authenticate,
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            propertiesByStatus: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  status: { type: "string" },
                  _count: { type: "integer" },
                },
              },
            },
            openIncidentsCount: { type: "integer" },
            recentIncidents: {
              type: "array",
              items: {
                type: "object",
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user.userId;
      const stats = await propertyService.getUserPropertyStats(userId);
      return stats;
    },
  });
}

export default propertyRoutes;
