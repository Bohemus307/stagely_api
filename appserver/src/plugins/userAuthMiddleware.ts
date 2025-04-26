import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

// Define the authenticated user type
export interface AuthenticatedUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  profilePictureUrl?: string;
}

// Define the authenticated request type
export interface AuthenticatedRequest extends FastifyRequest {
  authenticatedUser: AuthenticatedUser;
}

// Type augmentation for the FastifyRequest interface
declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser?: AuthenticatedUser;
  }

  interface FastifyInstance {
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  // Hook that runs after the Auth0 authentication
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip if we don't have Auth0 user data
    if (!request.user?.sub) {
      return;
    }

    try {
      // Look up the user in our database using Auth0 ID
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request.user.sub }
      });

      if (!user) {
        fastify.log.warn(`User not found for Auth0 ID: ${request.user.sub}`);
        return reply.code(401).send({
          error: 'User not found',
          message: 'Your account exists in Auth0 but not in our database'
        });
      }

      // Set the authenticated user on the request
      request.authenticatedUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePictureUrl: user.profilePictureUrl || undefined
      };

      // Optional: Update last login timestamp if it's been more than a day
      if (!user.lastLogin ||
          (user.lastLogin && new Date().getTime() - user.lastLogin.getTime() > 24 * 60 * 60 * 1000)) {
        await fastify.prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() }
        });
      }
    } catch (err) {
      fastify.log.error('Error in user auth middleware:', err);
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'An error occurred while processing your authentication'
      });
    }
  });

  // Helper middleware to verify the user exists and stop execution if not
  fastify.decorate('requireUser', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authenticatedUser) {
      return reply.code(401).send({
        error: 'Authentication required',
        message: 'You must be logged in to access this resource'
      });
    }
  });
}, {
  name: 'userAuthMiddleware',
  dependencies: ['prisma', 'fastify-auth0-express']
});
