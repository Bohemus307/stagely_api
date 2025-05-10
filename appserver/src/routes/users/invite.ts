// src/routes/users/invite.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendUnauthorized, sendNotFound } from "../../utils/responses";
import { InvitationService } from "../../services/invitation";
import { UserRepository } from "../../repositories/userRepository";

interface InviteUserBody {
  email: string;
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
        // Extract Auth0 ID with proper type checking
        const auth0Id = request?.user?.sub;
        if (!auth0Id) {
          return sendUnauthorized(reply, "Invalid authentication token");
        }

        const currentUser = await userRepository.getUserByAuth0Id(auth0Id);
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
        // Extract Auth0 ID with proper type checking
        const auth0Id = request?.user?.sub;
        if (!auth0Id) {
          return sendUnauthorized(reply, "Invalid authentication token");
        }

        const currentUser = await userRepository.getUserByAuth0Id(auth0Id);
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
}

export default inviteRoutes;
