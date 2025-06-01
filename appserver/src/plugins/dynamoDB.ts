import fp from "fastify-plugin";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Configuration options for the DynamoDB plugin
 */
interface DynamoDBPluginOptions {
  region?: string;
  endpoint?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/**
 * This plugin creates a shared DynamoDB Client instance
 * and decorates the Fastify instance with it.
 *
 * @param {FastifyInstance} fastify - The Fastify instance
 * @param {DynamoDBPluginOptions} options - Plugin options
 */
async function dynamoDBPlugin(
  fastify: any,
  options: DynamoDBPluginOptions = {},
) {
  // Set default region if not provided
  const region = options.region || process.env.AWS_REGION || "us-east-1";

  // Create client config
  const clientConfig: any = { region };

  // Add custom endpoint for local development if provided
  if (options.endpoint) {
    clientConfig.endpoint = options.endpoint;
  }

  // If you need different endpoints for local development:
  if (process.env.NODE_ENV === "development") {
    clientConfig.endpoint = "http://localhost:8000";
  }

  if (process.env.ACCESS_KEY && process.env.SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.ACCESS_KEY,
      secretAccessKey: process.env.SECRET_ACCESS_KEY,
    };
  } else {
    console.log("WARNING: No AWS credentials found in environment variables");
  }

  // Create the DynamoDB client
  const ddbClient = new DynamoDBClient(clientConfig);

  // Create the Document client (for easier DynamoDB interactions)
  const documentClient = DynamoDBDocumentClient.from(ddbClient);

  // Handle shutdown gracefully
  fastify.addHook("onClose", async (instance: any) => {
    // DynamoDB client doesn't have an explicit disconnect method,
    // but we can log the shutdown
    fastify.log.info("DynamoDB client shutting down");
  });

  try {
    // There's no explicit connection method for DynamoDB,
    // but we can test connectivity with a simple operation
    fastify.log.info("DynamoDB client initialized");
  } catch (err) {
    fastify.log.error("Failed to initialize DynamoDB client", err);
    throw err;
  }

  // Decorate the Fastify instance with both clients
  fastify.decorate("dynamoDB", {
    client: ddbClient,
    documentClient: documentClient,
  });
}

export default fp(dynamoDBPlugin, {
  name: "dynamoDB",
  fastify: "5.2.1",
});
