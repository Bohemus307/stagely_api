import Fastify, { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import imageComparisonPlugin from "./plugins/imageComparisonPlugin";

interface HealthResponse {
  status: string;
  message: string;
}

const server: FastifyInstance = Fastify({
  logger: true,
}).withTypeProvider<TypeBoxTypeProvider>();

const healthComments: string[] = [
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

server.get<{
  Reply: HealthResponse;
}>(
  "/health",
  {
    schema: {
      response: {
        200: Type.Object({
          status: Type.String(),
          message: Type.String(),
        }),
      },
    },
  },
  async (request, reply) => {
    const randomComment =
      healthComments[Math.floor(Math.random() * healthComments.length)];
    return {
      status: "healthy",
      message: randomComment,
    };
  }
);

server.register(imageComparisonPlugin);

const start = async () => {
  try {
    await server.listen({ port: 3000 });
    const address = server.server.address();
    const port = typeof address === "string" ? address : address?.port;
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
