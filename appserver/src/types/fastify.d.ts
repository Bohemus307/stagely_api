// src/types/fastify.d.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { S3Client } from "@aws-sdk/client-s3";

// Extend FastifyInstance interface
declare module "fastify" {
  interface FastifyInstance {
    // Add Prisma client
    prisma: PrismaClient;

    // Auth0 authentication functions
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;

    requireAuthentication: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;

    // User middleware function to ensure a user is in the database
    requireUser: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;

    // S3 client
    s3: {
      client: S3Client;
      bucket: string;
      region: string;
    };

    // DynamoDB client
    dynamoDB: {
      client: any;
      documentClient: any;
    };
  }

  // Extend FastifyRequest interface
  interface FastifyRequest {
    // Request timing
    startTime: [number, number];

    // Auth0 user information
    user?: {
      sub: string;
      [key: string]: any;
    };

    // Our database user information
    authenticatedUser?: {
      id: number;
      email: string;
      firstName: string;
      lastName: string;
      profilePictureUrl?: string;
    };
  }
}
