import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { createHash } from "crypto";
import closeWithGrace from "close-with-grace";
import { config } from "dotenv";
import autoLoad from "@fastify/autoload";
import path from "path";
import { PrismaClient } from "@prisma/client";

// Define custom properties on FastifyRequest
declare module "fastify" {
  export interface FastifyInstance {
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    startTime: [number, number];
  }
}

// Load environment variables from .env file
config();

// Define server configuration
const serverConfig = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
};

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

// Server creation with additional options
const server = Fastify({
  logger: {
    level: serverConfig.NODE_ENV === "production" ? "info" : "debug",
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          hostname: request.hostname,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
        };
      },
    },
  },
  trustProxy: true, // Trust proxies for proper client IP detection
  disableRequestLogging: false, // Enable request logging
  ignoreTrailingSlash: true, // Handle routes with or without trailing slash
  connectionTimeout: 30000, // Connection timeout in ms
  maxParamLength: 100, // Prevent excessive parameter length
});

// Health check with additional information
server.get(
  "/health",
  {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            message: { type: "string" },
            version: { type: "string" },
            timestamp: { type: "string" },
            requestId: { type: "string" },
          },
        },
      },
    },
  },
  async (request, reply) => {
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
);

// Define interface for error response
interface ErrorResponse {
  error: {
    statusCode: number;
    message: string;
    stack?: string;
  };
}

// Global error handler
server.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  // Don't expose error details in production
  const isProduction = serverConfig.NODE_ENV === "production";

  const statusCode = error.statusCode || 500;

  const response: ErrorResponse = {
    error: {
      statusCode,
      message:
        isProduction && statusCode === 500
          ? "Internal Server Error"
          : error.message,
    },
  };

  if (!isProduction) {
    response.error.stack = error.stack;
  }

  reply.status(statusCode).send(response);
});

// Not found handler
server.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: {
      statusCode: 404,
      message: `Route ${request.method}:${request.url} not found`,
    },
  });
});

// Security headers
server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "validator.swagger.io"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
});

// Rate limiting
server.register(rateLimit, {
  max: serverConfig.RATE_LIMIT_MAX,
  timeWindow: "1 minute",
  errorResponseBuilder: (request, context) => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: `Rate limit exceeded, retry in ${context.after}`,
  }),
});

// CORS configuration
server.register(cors, {
  origin: serverConfig.CORS_ORIGIN,
  methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true,
  maxAge: 86400, // 24 hours
  preflight: true,
});

// Response compression
server.register(compress, {
  encodings: ["gzip", "deflate"],
});

// Register your plugins
server.register(autoLoad, {
  dir: path.join(__dirname, "plugins"),
});

// Start the server with graceful shutdown
const start = async () => {
  try {
    // Add hooks for performance monitoring
    server.addHook("onRequest", (request, reply, done) => {
      // Store the start time
      request.startTime = process.hrtime();
      done();
    });

    server.addHook("onResponse", (request, reply, done) => {
      // TypeScript will infer the type automatically
      const hrtime = process.hrtime(request.startTime);
      const responseTime = hrtime[0] * 1e3 + hrtime[1] / 1e6;
      request.log.info({
        responseTime: `${responseTime.toFixed(2)}ms`,
        status: reply.statusCode,
        url: request.url,
        method: request.method,
      });
      done();
    });

    // Start listening
    await server.listen({
      port: serverConfig.PORT,
      host: "0.0.0.0", // Listen on all network interfaces
    });

    // Get address info
    const address = server.server.address();
    const port = typeof address === "string" ? address : address?.port;
    server.log.info(
      `Server listening on port ${port} in ${serverConfig.NODE_ENV} mode`,
    );

    // Graceful shutdown
    closeWithGrace({ delay: 10000 }, async ({ signal, err, manual }) => {
      server.log.info(`Shutting down due to ${signal}`);
      await server.close();
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Check if this file is being run directly
if (require.main === module) {
  start();
}

// Export server and config for testing
export { server, serverConfig, start };
