import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import buildGetJwks from "get-jwks"; // Change to import syntax

// Extend the FastifyInstance type to include our decorators
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any, done: any) => void;
    checkPermissions: (
      scopes: string | string[],
    ) => (request: any, reply: any, done: any) => void;
  }

  // Also declare the JWT user payload type
  interface FastifyRequest {
    user: {
      userId: number;
      role: string;
      sub: string;
      // Add other properties from your JWT token
    };
  }
}

export default fp(
  function (fastify: FastifyInstance, _opts: any, done: () => void) {
    const getJwks = buildGetJwks();

    // Register JWT plugin
    fastify.register(require("@fastify/jwt"), {
      decode: { complete: true },
      secret: (request: any, token: any) => {
        const {
          header: { kid, alg },
        } = token;
        return getJwks.getPublicKey({
          kid,
          domain: process.env.AUTH0_DOMAIN,
          alg,
        });
      },
      verify: {
        audience: process.env.AUTH0_AUDIENCE,
        issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      },
    });

    // Authentication decorator
    fastify.decorate(
      "authenticate",
      function (request: any, reply: any, done: any) {
        request.jwtVerify((err: any) => {
          if (err) {
            reply.code(401).send({ error: "Unauthorized" });
            return;
          }
          done();
        });
      },
    );

    // Permissions check decorator
    fastify.decorate("checkPermissions", function (scopes: string | string[]) {
      return function (request: any, reply: any, done: any) {
        const userScopes = request.user?.scope?.split(" ") || [];

        const hasScopes = Array.isArray(scopes)
          ? scopes.every((scope) => userScopes.includes(scope))
          : userScopes.includes(scopes);

        if (hasScopes) {
          done();
        } else {
          reply.code(403).send({ error: "Insufficient permissions" });
        }
      };
    });

    done();
  },
  {
    name: "auth0Plugin",
    fastify: "5.2.1",
  },
);
