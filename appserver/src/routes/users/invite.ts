// src/routes/users/invite.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendNotFound, sendUnauthorized } from "../../utils/responses";
import { InvitationService } from "../../services/invitation";
import { UserRepository } from "../../repositories/userRepository";

interface InviteUserBody {
  email: string;
}

// Define User interface for type safety
interface AuthUser {
  sub: string;
  [key: string]: any;
}

/**
 * User invitation routes
 */
async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
  // Initialize repository and service
  const userRepository = new UserRepository(fastify.prisma);
  const invitationService = new InvitationService(userRepository, fastify.email);

  // Invite a user
  fastify.route({
    method: "POST",
    url: "/invite",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["users"],
      description: "Invite a user to the platform",
      summary: "Invite user",
      body: {
        type: "object",
        properties: {
          email: {
            type: "string",
            format: "email",
            description: "Email to invite"
          }
        },
        required: ["email"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            user: {
              type: "object",
              properties: {
                id: { type: "integer" },
                email: { type: "string" },
                isPlaceholder: { type: "boolean" }
              }
            }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        // The fastify.authenticate middleware ensures we have a user object
        // but TypeScript needs type checking
        const user = request.user as AuthUser | undefined;
        if (!user?.sub) {
          return sendUnauthorized(reply, "Invalid authentication token");
        }

        const currentUser = await userRepository.getUserByAuth0Id(user.sub);
        if (!currentUser) {
          return sendUnauthorized(reply, "User not found");
        }

        const { email } = request.body as InviteUserBody;

        const result = await invitationService.inviteUser(
          email,
          currentUser.id,
          `${currentUser.firstName} ${currentUser.lastName}`
        );

        return {
          success: true,
          user: result.user
        };
      } catch (err: any) {
        fastify.log.error(err);

        reply.code(500).send({
          success: false,
          error: err.message || "Failed to create invitation"
        });
      }
    }
  });

  // Accept an invitation
  fastify.route({
    method: "POST",
    url: "/accept-invitation",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["users"],
      description: "Accept an invitation",
      summary: "Accept invitation",
      body: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "Invitation token"
          }
        },
        required: ["token"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        // Type checking for TypeScript
        const user = request.user as AuthUser | undefined;
        if (!user?.sub) {
          return sendUnauthorized(reply, "Invalid authentication token");
        }

        const currentUser = await userRepository.getUserByAuth0Id(user.sub);
        if (!currentUser) {
          return sendUnauthorized(reply, "User not found");
        }

        const { token } = request.body as { token: string };

        const success = await invitationService.acceptInvitation(token, currentUser);

        if (!success) {
          return sendNotFound(reply, "Invitation not found or expired");
        }

        return {
          success: true,
          message: "Invitation accepted successfully"
        };
      } catch (err: any) {
        fastify.log.error(err);

        reply.code(500).send({
          success: false,
          error: err.message || "Failed to accept invitation"
        });
      }
    }
  });

  // Check invitation
  fastify.route({
    method: "GET",
    url: "/check-invitation",
    schema: {
      tags: ["users"],
      description: "Check if an invitation token is valid",
      summary: "Check invitation",
      querystring: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "Invitation token"
          }
        },
        required: ["token"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            email: { type: "string", nullable: true }
          }
        }
      }
    },
    handler: async (request, reply) => {
      try {
        const { token } = request.query as { token: string };

        const result = await invitationService.checkInvitation(token);

        return result;
      } catch (err: any) {
        fastify.log.error(err);

        reply.code(500).send({
          success: false,
          error: err.message || "Failed to check invitation"
        });
      }
    }
  });

  // DELETE invitation - for testing purposes only
  fastify.route({
    method: "DELETE",
    url: "/invitation",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["users"],
      description: "Delete an invitation (for testing purposes only)",
      summary: "Delete invitation",
      querystring: {
        type: "object",
        properties: {
          email: {
            type: "string",
            format: "email",
            description: "Email address of the invitation to delete"
          },
          
        },
        // Make one of them required
        oneOf: [
          { required: ["email"] }
        ]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" }
          }
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Invitation not found" }
          }
        }
      },
      security: [{ bearerAuth: [] }]
    },
    handler: async (request, reply) => {
      try {
        // The fastify.authenticate middleware ensures we have a user object
        const user = request.user as AuthUser | undefined;
        if (!user?.sub) {
          return sendUnauthorized(reply, "Invalid authentication token");
        }

        const currentUser = await userRepository.getUserByAuth0Id(user.sub);
        if (!currentUser) {
          return sendUnauthorized(reply, "User not found");
        }


        const { email, token } = request.query as { email?: string, token?: string };

        // Call the service method to delete the invitation
        const deleted = await invitationService.deleteInvitation({ email, token });

        if (!deleted) {
          return sendNotFound(reply, "Invitation not found");
        }

        return {
          success: true,
          message: "Invitation deleted successfully"
        };
      } catch (err: any) {
        fastify.log.error(err);

        reply.code(500).send({
          success: false,
          error: err.message || "Failed to delete invitation"
        });
      }
    }
  });
}


export default inviteRoutes;

