// plugins/health.ts
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createHash } from "crypto";

interface HealthPluginOptions {
  prefix?: string;
}

const healthComments = [
  "🦄 Unicorns are powering the servers today!",
  "🍕 All systems operational, fueled by pizza!",
  "🤖 Beep boop, all circuits functioning normally.",
  "🧠 Our AI is feeling particularly clever right now.",
  "🌈 Servers are riding on rainbows, everything's colorful!",
  "🍪 Cookie-based load balancing is working perfectly.",
  "🐒 Code monkeys are working overtime, all's well!",
  "🎩 Our servers are feeling particularly dapper today.",
  "🚀 Systems are go for launch! ...metaphorically speaking.",
  "🧙‍♂️ Our wizard sysadmin cast 'Server Uptime Maximus'. It's super effective!",
  "🦥 Servers are running so smoothly, they're practically in slow motion.",
  "🌟 Star-powered quantum computing is online. Or maybe it's just really good coding.",
];

const healthPlugin: FastifyPluginAsync<HealthPluginOptions> = async (
  fastify: FastifyInstance,
  options: HealthPluginOptions,
): Promise<void> => {
  fastify.route({
    method: "GET",
    url: `/health`,
    schema: {
      tags: ["system"],
      description: "Check API health status",
      summary: "Health check",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string", example: "healthy" },
            message: { type: "string", example: "All systems operational!" },
            version: { type: "string", example: "1.0.0" },
            timestamp: { type: "string", example: "2025-03-11T12:00:00Z" },
            requestId: { type: "string", example: "a1b2c3d4" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const randomComment =
        healthComments[Math.floor(Math.random() * healthComments.length)];
      const requestId = createHash("sha256")
        .update(request.id)
        .digest("hex")
        .substring(0, 8);

      return {
        status: "healthy",
        message: randomComment,
        version: process.env.npm_package_version || "1.0.0",
        timestamp: new Date().toISOString(),
        requestId,
      };
    },
  });
};

export default fp(healthPlugin, {
  name: "health-endpoint",
  fastify: "5.2.1",
});
