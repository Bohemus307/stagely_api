import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { auth } from "express-oauth2-jwt-bearer";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { S3Client } from "@aws-sdk/client-s3";
import { EmailService } from "../services/email";

interface FastifyAuth0Options {
  domain: string;
  audience: string | string[];
}

interface DecodedToken {
  iss?: string;
  [key: string]: any;
}

async function auth0Plugin(
  fastify: FastifyInstance,
  options: FastifyAuth0Options,
) {
  if (!options.domain) {
    throw new Error("Auth0 domain is required");
  }

  if (!options.audience) {
    throw new Error("Auth0 audience is required");
  }

  // Create the Auth0 JWT validator
  const validateJwt = auth({
    audience: options.audience,
    issuerBaseURL: `https://${options.domain}`,
  });

  // Add authenticate method
  fastify.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        // Extract token from authorization header
        const authHeader = request.headers.authorization;
        const token = authHeader?.split(" ")[1];

        if (!token) {
          reply.code(401).send({ error: "No token provided" });
          return;
        }

        // Decode token to check issuer
        const decoded = jwt.decode(token) as DecodedToken;
        const issuer = decoded?.iss?.replace(/\/$/, "");

        if (!issuer || !issuer.includes(options.domain)) {
          reply.code(403).send({ error: `Unauthorized issuer` });
          return;
        }

        // Create a middleware-style promise for the auth check
        await new Promise<void>((resolve, reject) => {
          // Create mock express req/res/next
          const mockReq: any = {
            headers: request.headers,
            query: request.query,
            is: (type: string) => false, // Mock req.is() function
            url: request.url,
            method: request.method,
          };

          const mockRes: any = {
            setHeader: () => {},
            status: () => mockRes,
            send: () => mockRes,
          };

          const mockNext = (error?: any) => {
            if (error) {
              reject(error);
            } else {
              // Copy user info from mock request to Fastify request
              if (mockReq.auth && mockReq.auth.payload) {
                request.user = mockReq.auth.payload;
              }
              resolve();
            }
          };

          // Run the express middleware
          validateJwt(mockReq, mockRes, mockNext);
        });
      } catch (err) {
        reply.code(401).send({
          error: "Unauthorized",
          message: err instanceof Error ? err.message : "Invalid token",
        });
      }
    },
  );

  // Also provide a convenient onRequest hook
  fastify.decorate(
    "requireAuthentication",
    async function (request: FastifyRequest, reply: FastifyReply) {
      return fastify.authenticate(request, reply);
    },
  );
}

// Add module augmentation for TypeScript to recognize our methods
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireAuthentication: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    s3: {
      client: S3Client;
      bucket: string;
      region: string;
    };
    email: {
      service: EmailService;
      sendInvitationEmail: (
        email: string,
        token: string,
        inviterName: string,
      ) => Promise<any>;
    };
  }

  interface FastifyRequest {
    startTime: [number, number];
    user?: {
      sub: string;
      [key: string]: any;
    };
  }
}

export default fp(auth0Plugin, {
  fastify: "5.2.1",
  name: "fastify-auth0-express",
});
