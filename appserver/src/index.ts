import Fastify, {
  FastifyError,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import closeWithGrace from "close-with-grace";
import { config } from "dotenv";
import autoLoad from "@fastify/autoload";
import path from "path";
import healthPlugin from "./plugins/healthPlugin";
import prismaPlugin from "./plugins/prismaPlugin";
import auth0Plugin from "./plugins/auth0Plugin";
import s3Plugin from "./plugins/s3Plugin";
import dynamoDB from "./plugins/dynamoDB";

// Load environment variables from .env file
config();

// Define server configuration
const serverConfig = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  DOMAIN: `${process.env.AUTH0_DOMAIN}`,
  AUDIENCE: process.env.AUTH0_AUDIENCE,
};

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
  connectionTimeout: 120000, // Connection timeout in ms
  maxParamLength: 100, // Prevent excessive parameter length
});

interface ErrorResponse {
  error: {
    statusCode: number;
    message: string;
    stack?: string;
  };
}

// Global error handler
server.setErrorHandler(
  (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
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
  },
);

server.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
  reply.status(404).send({
    error: {
      statusCode: 404,
      message: `Route ${request.method}:${request.url} not found`,
    },
  });
});

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

server.register(require("@fastify/swagger"), {
  routePrefix: "/documentation",
  swagger: {
    info: {
      title: "Stagely API",
      description: "Property management API documentation",
      version: "1.0.0",
      contact: {
        name: "API Support",
        email: "support@example.com",
        url: "https://example.com/support",
      },
    },
    host: process.env.AUTH0_DOMAIN || "localhost:3000",
    schemes: ["http", "https"],
    consumes: ["application/json"],
    produces: ["application/json"],
    tags: [
      { name: "properties", description: "Property management endpoints" },
      { name: "incidents", description: "Incident management endpoints" },
      { name: "inspections", description: "Inspection management endpoints" },
      {
        name: "property-spaces",
        description: "Property Spaces management endpoints",
      },
      { name: "system", description: "System health and diagnostics" },
      { name: "s3", description: "Image Url management" },
      { name: "users", description: "Creation and management of users" },
    ],
    securityDefinitions: {
      bearerAuth: {
        type: "apiKey",
        name: "Authorization",
        in: "header",
        description:
          'Enter the auth0 access token with the `Bearer: ` prefix, e.g. "Bearer abcde12345"',
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  exposeRoute: true,
});

server.register(require("@fastify/swagger-ui"), {
  routePrefix: "/documentation",
  uiConfig: {
    docExpansion: "list",
    deepLinking: true,
    displayRequestDuration: true,
  },
  staticCSP: true,
  transformStaticCSP: (header: any) => header,
});

server.register(prismaPlugin);
server.register(healthPlugin);
server.register(s3Plugin);
server.register(dynamoDB);

server.register(auth0Plugin, {
  domain: serverConfig.DOMAIN,
  audience: serverConfig.AUDIENCE as string,
});

server.register(autoLoad, {
  dir: path.join(__dirname, "routes"),
  dirNameRoutePrefix: true,
});

const start = async () => {
  try {
    // Add hooks for performance monitoring
    server.addHook(
      "onRequest",
      (
        request: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction,
      ) => {
        request.startTime = process.hrtime();
        done();
      },
    );

    server.addHook(
      "onResponse",
      (
        request: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction,
      ) => {
        const hrtime = process.hrtime(request.startTime);
        const responseTime = hrtime[0] * 1e3 + hrtime[1] / 1e6;
        request.log.info({
          responseTime: `${responseTime.toFixed(2)}ms`,
          status: reply.statusCode,
          url: request.url,
          method: request.method,
        });
        done();
      },
    );

    // Start listening
    await server.listen({
      port: serverConfig.PORT,
      host: "0.0.0.0", // Listen on all network interfaces
    });

    const address = server.server.address();
    const port = typeof address === "string" ? address : address?.port;
    server.log.info(
      `Server listening on port ${port} in ${serverConfig.NODE_ENV} mode`,
    );

    closeWithGrace({ delay: 10000 }, async ({ signal, err, manual }) => {
      server.log.info(`Shutting down due to ${signal}`);
      await server.close();
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

export { server, serverConfig, start };
