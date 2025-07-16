// src/routes/users/invite.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendNotFound, sendUnauthorized } from "../../utils/responses";
import { InvitationService } from "../../services/invitation";
import { UserRepository } from "../../repositories/userRepository";
import { EventType } from "../../repositories/dynamoDB/eventsRepository";

interface InviteUserBody {
  email: string;
}

interface AcceptInvitationBody {
  token: string;
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
  const invitationService = new InvitationService(
    userRepository,
    fastify.email,
  );

  // Invite a user
  fastify.route({
    method: "POST",
    url: "/invite",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["invite"],
      description: "Invite a user to the platform",
      summary: "Invite user",
      body: {
        type: "object",
        properties: {
          userId: {
            type: "number",
            description: "userId of the user creating the invite",
          },
          email: {
            type: "string",
            format: "email",
            description: "Email to invite",
          },
        },
        required: ["email"],
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
                isPlaceholder: { type: "boolean" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
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

         // ✅ HIGH PRIORITY EVENT: Log invitation sent (only for new invitations)
        if (result.isNewInvitation) {
          await fastify.eventService.logUserInvitationSent(
            currentUser.id,
            email,
            currentUser.id,
            fastify.getEventMetadata(request)
          );
        }

        return {
          success: true,
          user: result.user,
          isNewInvitation: result.isNewInvitation
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
      tags: ["invite"],
      description: "Accept an invitation",
      summary: "Accept invitation",
      body: {
        type: "object",
        properties: {
          userId: {
            type: "number",
            description: "userId of the user with an invite",
          },
          token: {
            type: "string",
            description: "Invitation token",
          },
        },
        required: ["token"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const user = request.user as AuthUser | undefined;
        if (!user?.sub) {
          return sendUnauthorized(reply, "Invalid authentication token");
        }

        const currentUser = await userRepository.getUserByAuth0Id(user.sub);
        if (!currentUser) {
          return sendUnauthorized(reply, "User not found");
        }

        const { token } = request.body as AcceptInvitationBody;

        // Find the invitation
        const invitation = await userRepository.findByInvitationToken(token);
        if (!invitation) {
          return reply.code(400).send({
            success: false,
            error: "Invalid or expired invitation token"
          });
        }

        // Check if invitation belongs to the current user
        if (invitation.email !== currentUser.email) {
          return reply.code(400).send({
            success: false,
            error: "Invitation token does not match your email"
          });
        }

        // Accept the invitation (convert placeholder to real user)
        const result = await invitationService.acceptInvitation(
          currentUser.id,
          token
        );

        // ✅ HIGH PRIORITY EVENT: Log invitation acceptance for conversion tracking
        await fastify.eventService.logUserInvitationAccepted(
          currentUser.id,
          currentUser.email,
          token,
          fastify.getEventMetadata(request)
        );

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
      tags: ["invite"],
      description: "Check if an invitation token is valid",
      summary: "Check invitation",
      querystring: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "Invitation token",
          },
        },
        required: ["token"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            email: { type: "string", nullable: true },
          },
        },
      },
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
          error: err.message || "Failed to check invitation",
        });
      }
    },
  });

  // Resend invitation
  fastify.route({
    method: "POST",
    url: "/resend-invitation",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["invite"],
      description: "Resend an invitation email",
      summary: "Resend invitation",
      body: {
        type: "object",
        properties: {
          userId: {
            type: "number",
            description: "userId of the user thats resedn the invite",
          },
          email: {
            type: "string",
            format: "email",
            description: "Email to resend invitation to",
          },
        },
        required: ["email"],
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
                isPlaceholder: { type: "boolean" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      try {
        const { email, userId } = request.body as {
          email: string;
          userId: number;
        };

        // Get user by id and verify its auth0 id based on the sub then use that user much faster since its indexed by id
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
        });

        // Verify this user belongs to the authenticated user
        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const result = await invitationService.resendInvitation(
          email,
          `${user.firstName} ${user.lastName}`,
        );

        if (!result.success) {
          return reply.code(404).send({
            success: false,
            error: "No valid invitation found for this email",
          });
        }

        return {
          success: true,
          user: result.user,
        };
      } catch (err: any) {
        fastify.log.error(err);

        reply.code(500).send({
          success: false,
          error: err.message || "Failed to resend invitation",
        });
      }
    },
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
