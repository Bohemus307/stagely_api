import { FastifyInstance } from "fastify";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

interface PresignedUrlRequest {
  fileName: string;
  contentType: string;
}

/**
 * Routes for handling S3 operations
 */
export default async function s3Routes(
  fastify: FastifyInstance,
): Promise<void> {
  // POST /s3/get-presigned-url
  fastify.route({
    method: "POST",
    url: "/get-presigned-url",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["s3"],
      description: "Generate a pre-signed URL for S3 file upload",
      summary: "Get S3 pre-signed URL",
      body: {
        type: "object",
        required: ["fileName", "contentType"],
        properties: {
          fileName: {
            type: "string",
            description: "The original filename",
          },
          contentType: {
            type: "string",
            description: "MIME type of the file",
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            presignedUrl: {
              type: "string",
              description: "URL to upload the file to",
            },
            publicUrl: {
              type: "string",
              description: "URL where the file will be accessible after upload",
            },
          },
        },
        400: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { fileName, contentType } = request.body as PresignedUrlRequest;

      // Validate allowed file types
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/heic",
      ];
      if (!allowedTypes.includes(contentType)) {
        return reply.code(400).send({
          error: {
            statusCode: 400,
            message: `Invalid file type. Allowed types: ${allowedTypes.join(", ")}`,
          },
        });
      }

      try {
        // Get user ID from auth token for folder path
        const userId = request?.user?.sub;

        // Generate unique filename to prevent overwriting
        const fileExt = fileName.split(".").pop() || "";
        const uniqueFileName = `${uuidv4()}.${fileExt}`;
        const key = `uploads/${userId}/${uniqueFileName}`;

        // Create command for S3 upload
        const command = new PutObjectCommand({
          Bucket: fastify.s3.bucket,
          Key: key,
          ContentType: contentType,
        });

        // Generate presigned URL with a 10-minute expiration
        const presignedUrl = await getSignedUrl(fastify.s3.client, command, {
          expiresIn: 600,
        });

        // Generate the public URL
        const publicUrl = `https://${fastify.s3.bucket}.s3.${fastify.s3.region}.amazonaws.com/${key}`;

        // Return the URLs to the client
        return {
          presignedUrl,
          publicUrl,
        };
      } catch (err) {
        request.log.error(err);
        throw err;
      }
    },
  });
}
