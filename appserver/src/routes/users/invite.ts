// src/routes/users/invite.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { sendUnauthorized, sendNotFound, sendConflict } from "../../utils/responses";
import { EmailService } from "../../services/email/index";

declare module 'fastify' {
  interface FastifyInstance {
    email: {
      service: EmailService;
      sendInvitationEmail: (email: string, token: string, inviterName: string) => Promise<string>;
    }
  }
}

interface InviteUserBody {
  email: string;
}

/**
 * User invitation routes
 */
async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
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
        const currentUser = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!currentUser) {
          return sendUnauthorized(reply, "User not found");
        }

        const { email } = request.body as InviteUserBody;

        // Check if user already exists
        let user = await fastify.prisma.user.findUnique({
          where: {
            email,
            isPlaceholder: false
          }
        });

        if (user) {
          // User already exists - return existing user
          return {
            success: true,
            user: {
              id: user.id,
              email: user.email,
              isPlaceholder: false
            }
          };
        }

        // Check for existing invitation
        user = await fastify.prisma.user.findFirst({
          where: {
            email,
            isPlaceholder: true,
            expiresAt: {
              gt: new Date()
            }
          }
        });

        if (user) {
          // Invitation already exists - return the placeholder user
          return {
            success: true,
            user: {
              id: user.id,
              email: user.email,
              isPlaceholder: true
            }
          };
        }

        // Create new placeholder user with invitation
        const invitationToken = uuidv4();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

        const newUser = await fastify.prisma.user.create({
          data: {
            email,
            firstName: "Invited",
            lastName: "User",
            auth0Id: `placeholder-${invitationToken}`,
            isPlaceholder: true,
            invitationToken,
            invitedById: currentUser.id,
            expiresAt
          }
        });

        // Send invitation email
        try {
          // Using the fastify.email plugin instead of directly instantiating EmailService
          await fastify.email.sendInvitationEmail(
            email,
            invitationToken,
            `${currentUser.firstName} ${currentUser.lastName}`
          );
        } catch (error) {
          fastify.log.error("Failed to send invitation email:", error);
          // Continue even if email sending fails
        }

        return {
          success: true,
          user: {
            id: newUser.id,
            email: newUser.email,
            isPlaceholder: true
          }
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
        const currentUser = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub }
        });

        if (!currentUser) {
          return sendUnauthorized(reply, "User not found");
        }

        const { token } = request.body as { token: string };

        // Find the placeholder user
        const placeholderUser = await fastify.prisma.user.findFirst({
          where: {
            invitationToken: token,
            isPlaceholder: true,
            expiresAt: {
              gt: new Date()
            }
          }
        });

        if (!placeholderUser) {
          return sendNotFound(reply, "Invitation not found or expired");
        }

        // Update the placeholder user with current user's details
        await fastify.prisma.user.update({
          where: { id: placeholderUser.id },
          data: {
            auth0Id: currentUser.auth0Id,
            firstName: currentUser.firstName,
            lastName: currentUser.lastName,
            profilePictureUrl: currentUser.profilePictureUrl,
            isPlaceholder: false,
            invitationToken: null,
            expiresAt: null
          }
        });

        // Delete the current user since we're transferring identity
        // Only do this if the users are different
        if (currentUser.id !== placeholderUser.id) {
          await fastify.prisma.user.delete({
            where: { id: currentUser.id }
          });
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

        const placeholderUser = await fastify.prisma.user.findFirst({
          where: {
            invitationToken: token,
            isPlaceholder: true,
            expiresAt: {
              gt: new Date()
            }
          }
        });

        return {
          valid: !!placeholderUser,
          email: placeholderUser?.email || null
        };
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
