import { FastifyPluginAsync } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { S3Client } from "@aws-sdk/client-s3";

// Define the S3 plugin options interface
interface S3PluginOptions {
  bucket?: string;
  region?: string;
}

/**
 * Plugin to register S3 client with Fastify
 */
const s3Plugin: FastifyPluginAsync<S3PluginOptions> = async (
  fastify,
  options,
) => {
  const bucket = options.bucket || process.env.S3_BUCKET_NAME;
  const region = options.region || process.env.AWS_REGION || "us-east-1";

  if (!bucket) {
    throw new Error(
      "S3_BUCKET must be specified in environment or plugin options",
    );
  }

  // Create S3 client
  const s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.ACCESS_KEY || "noS3creds",
      secretAccessKey: process.env.SECRET_ACCESS_KEY || "noS3creds",
    },
  });

  // Decorate Fastify instance with S3 client and bucket info
  fastify.decorate("s3", {
    client: s3Client,
    bucket,
    region,
  });

  // Clean up on close
  fastify.addHook("onClose", async (instance) => {
    await instance.s3.client.destroy();
  });
};

export default fastifyPlugin(s3Plugin);
