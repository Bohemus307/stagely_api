import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import fastifyJwtJwks from "fastify-jwt-jwks";

// Create a separate namespace for @fastify/jwt type augmentation
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: string;
      userId: number;
      scope: string;
      [key: string]: any;
    };
  }
}

export default fp(
  async function (fastify: FastifyInstance, _opts: any) {
    // Log environment variables at startup
    console.log("Starting auth plugin with:");
    console.log("AUTH0_DOMAIN:", process.env.AUTH0_DOMAIN);
    console.log("AUTH0_AUDIENCE:", process.env.AUTH0_AUDIENCE);

    // Check if environment variables are defined
    if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
      throw new Error(
        "Required environment variables AUTH0_DOMAIN or AUTH0_AUDIENCE are not set",
      );
    }

    const domain = process.env.AUTH0_DOMAIN;
    const audience = process.env.AUTH0_AUDIENCE;

    // Register the fastify-jwt-jwks plugin
    await fastify.register(fastifyJwtJwks, {
      jwksUrl: `https://${domain}/.well-known/jwks.json`,
      audience: [audience, audience + "/"],
      issuer: `https://${domain}/`,
      complete: true,
    });

    // This preHandler hook will run after the existing authenticate decorator
    // but before your route handlers, ensuring JWT verification happens
    fastify.addHook("preHandler", async (request, reply) => {
      // Check if this route uses the authenticate hook
      // We can tell by checking if it's a protected route (has Authorization header)
      if (request.headers.authorization && !request.user) {
        try {
          // Verify JWT if not already done
          await request.jwtVerify();
          console.log("JWT verified in preHandler hook");
        } catch (err) {
          // Don't send error response here, just log it
          console.error("JWT verification failed:", err);
        }
      }

      // Normalize user object if it exists
      if (request.user) {
        // Make sure userId is a number if it exists
        if (request.user.userId && typeof request.user.userId === "string") {
          request.user.userId = parseInt(request.user.userId, 10);
        }

        console.log("User object set up properly:", request.user.payload.sub);
      }
    });

    // Permissions check decorator
    fastify.decorate(
      "checkPermissions",
      function (requiredScopes: string | string[]) {
        return async function (
          request: { user: { scope: string } },
          reply: {
            code: (arg0: number) => {
              (): any;
              new (): any;
              send: { (arg0: { error: string }): void; new (): any };
            };
          },
        ) {
          try {
            // Authentication should have been done already
            if (!request.user) {
              throw new Error("User not authenticated");
            }

            // Get user scopes from token
            const scopeString = request.user.scope || "";
            const userScopes = scopeString.split(" ");

            // Check if user has required scopes
            const hasRequiredScopes = Array.isArray(requiredScopes)
              ? requiredScopes.every((scope) => userScopes.includes(scope))
              : userScopes.includes(requiredScopes);

            if (!hasRequiredScopes) {
              reply.code(403).send({ error: "Insufficient permissions" });
              return;
            }
          } catch (err) {
            reply.code(401).send({ error: "Unauthorized" });
            return;
          }
        };
      },
    );
  },
  {
    name: "auth0Plugin",
    fastify: "5.2.1",
  },
);
