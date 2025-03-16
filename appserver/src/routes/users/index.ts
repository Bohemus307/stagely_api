import { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../utils/errors";
import { UserService } from "../../services/users";
import { sendNotFound, sendConflict } from "../../utils/responses";
import userSchemas from "../../schemas/user-schema";

// Define route parameter types
interface ParamsWithId {
  id: string;
}

interface QueryParams {
  page?: string;
  limit?: string;
  role?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

// Define user JWT payload type
interface JwtUser {
  userId: number;
  role: string;
  sub: string;
}

// Declare jwt for fastify request - this should match your Auth0 plugin
declare module "fastify" {
  interface FastifyRequest {
    user: JwtUser;
  }
}

/**
 * User routes
 *
 * @param fastify - The Fastify instance
 */
async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // Get service instance with Prisma
  const userService = new UserService(fastify.prisma);

  // GET /users
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Get a list of users with optional filtering",
      summary: "List all users",
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
          role: {
            type: "string",
            enum: ["user", "admin", "manager"],
            description: "Filter by user role",
          },
          search: {
            type: "string",
            description: "Search by name or email",
          },
          sortBy: {
            type: "string",
            enum: ["createdAt", "lastName", "email"],
            default: "createdAt",
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
        200: userSchemas.usersResponseSchema,
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const queryParams = request.query as QueryParams;

      const result = await userService.getUsers({
        page: queryParams.page ? parseInt(queryParams.page) : undefined,
        limit: queryParams.limit ? parseInt(queryParams.limit) : undefined,
        role: queryParams.role,
        search: queryParams.search,
        sortBy: queryParams.sortBy,
        sortOrder: queryParams.sortOrder as "asc" | "desc" | undefined,
      });

      return result;
    },
  });

  // GET /users/:id
  fastify.route({
    method: "GET",
    url: "/:id",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Get a single user by ID",
      summary: "Get user details",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "User ID" },
        },
        required: ["id"],
      },
      response: {
        200: userSchemas.userResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "User not found" },
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

      try {
        const user = await userService.getUserById(parseInt(id));
        return user;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "User not found");
        }
        throw err;
      }
    },
  });

  // GET /users/me
  fastify.route({
    method: "GET",
    url: "/me",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Get current user profile",
      summary: "Get current user",
      response: {
        200: userSchemas.userResponseSchema,
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      // Use the correct method name from your service
      const authId = request.user.sub;

      try {
        // Changed from getUserByAuthId to getUserByAuth0Id to match your service
        const user = await userService.getUserByAuth0Id(authId);
        if (!user) {
          return sendNotFound(reply, "User not found");
        }
        return user;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "User not found");
        }
        throw err;
      }
    },
  });

  // POST /users
  fastify.route({
    method: "POST",
    url: "/",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Create a new user",
      summary: "Create user",
      body: userSchemas.createUserSchema,
      response: {
        201: userSchemas.userResponseSchema,
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: {
                  type: "string",
                  example: "Email already in use",
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
      try {
        const user = await userService.createUser(request.body as any);

        reply.code(201);
        return user;
      } catch (err: any) {
        // Handle specific errors with appropriate status codes
        fastify.log.error(err);

        if (err instanceof ConflictError || err.code === "P2002") {
          return sendConflict(reply, "Email already in use");
        }

        throw err;
      }
    },
  });

  // PUT /users/:id
  fastify.route({
    method: "PUT",
    url: "/:id",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Update an existing user",
      summary: "Update user",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "User ID" },
        },
        required: ["id"],
      },
      body: userSchemas.updateUserSchema,
      response: {
        200: userSchemas.userResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "User not found" },
              },
            },
          },
        },
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: { type: "string", example: "Email already in use" },
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

      try {
        const user = await userService.updateUser(
          parseInt(id),
          request.body as any,
        );
        return user;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "User not found");
        }
        if (err instanceof ConflictError) {
          return sendConflict(reply, err.message);
        }
        throw err;
      }
    },
  });

  // DELETE /users/:id
  fastify.route({
    method: "DELETE",
    url: "/:id",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Delete a user",
      summary: "Delete user",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "User ID" },
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
                message: { type: "string", example: "User not found" },
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

      try {
        await userService.deleteUser(parseInt(id));
        return { success: true, id: parseInt(id) };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "User not found");
        }
        throw err;
      }
    },
  });

  // GET /users/search
  fastify.route({
    method: "GET",
    url: "/search",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Search for users by name or email",
      summary: "Search users",
      querystring: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
            minLength: 2,
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            default: 5,
            description: "Maximum number of results",
          },
        },
        required: ["query"],
      },
      response: {
        200: userSchemas.userSearchResponseSchema,
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { query, limit } = request.query as {
        query: string;
        limit?: string;
      };

      const results = await userService.searchUsers(
        query,
        limit ? parseInt(limit) : undefined,
      );

      return results;
    },
  });

  // GET /users/stats
  fastify.route({
    method: "GET",
    url: "/stats",
    onRequest: [fastify.authenticate], // Use array syntax and onRequest
    schema: {
      tags: ["users"],
      description: "Get statistics about the current user",
      summary: "User statistics",
      response: {
        200: userSchemas.userStatsResponseSchema,
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      // Extract user ID from Auth0 token
      const userId = request.user.userId;
      const stats = await userService.getUserStats(userId);
      return stats;
    },
  });
}

export default userRoutes;
