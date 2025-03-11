import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from "../../utils/errors";
import { UserService } from "../../services/users";
import {
  sendUnauthorized,
  sendNotFound,
  sendForbidden,
  sendConflict,
} from "../../utils/responses";
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
}

// Declare jwt for fastify request
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
   * Admin-only middleware
   */
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    await authenticate(request, reply);

    if (request.user?.role !== "admin") {
      return sendForbidden(reply, "Admin access required");
    }
  }

  // GET /users
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: requireAdmin,
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
    onRequest: authenticate,
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

      // Only allow users to access their own profile or admins to access any profile
      if (!isAdmin && parseInt(id) !== userId) {
        return sendForbidden(reply, "Access denied");
      }

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
    onRequest: authenticate,
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
      const userId = request.user.userId;

      try {
        const user = await userService.getUserById(userId);
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
    onRequest: requireAdmin,
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
    onRequest: authenticate,
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
      const userId = request.user.userId;
      const isAdmin = request.user.role === "admin";

      // Users can only update their own profile
      // Admins can update any profile but only admins can set the role to "admin"
      if (!isAdmin && parseInt(id) !== userId) {
        return sendForbidden(reply, "Access denied");
      }

      // If not admin, prevent changing the role
      const updateData = { ...(request.body as any) };
      if (!isAdmin) {
        delete updateData.role;
      }

      try {
        const user = await userService.updateUser(parseInt(id), updateData);
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
    onRequest: requireAdmin,
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
    onRequest: authenticate,
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
    onRequest: authenticate,
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
      const userId = request.user.userId;
      const stats = await userService.getUserStats(userId);
      return stats;
    },
  });
}

export default userRoutes;
