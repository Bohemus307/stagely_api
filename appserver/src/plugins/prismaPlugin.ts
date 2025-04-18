// src/plugins/prisma.js
import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import { DefaultArgs } from "@prisma/client/runtime/library";

/**
 * This plugin creates a shared Prisma Client instance
 * and decorates the Fastify instance with it.
 *
 * @param {FastifyInstance} fastify - The Fastify instance
 * @param {Object} options - Plugin options
 */
async function prismaPlugin(
  fastify: {
    addHook: (arg0: string, arg1: (instance: any) => Promise<void>) => void;
    log: {
      info: (arg0: string) => void;
      error: (arg0: string, arg1: unknown) => void;
    };
    decorate: (
      arg0: string,
      arg1: PrismaClient<
        { log: ("info" | "query" | "warn" | "error")[] },
        never,
        DefaultArgs
      >,
    ) => void;
  },
  options: any,
) {
  const prisma = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"],
  });

  // Handle shutdown gracefully
  fastify.addHook("onClose", async (instance: any) => {
    await prisma.$disconnect();
  });

  try {
    await prisma.$connect();
    fastify.log.info("Connected to database");
  } catch (err) {
    fastify.log.error("Failed to connect to database", err);
    throw err;
  }

  fastify.decorate("prisma", prisma);
}

export default fp(prismaPlugin, {
  name: "prisma",
  fastify: "5.2.1",
});
