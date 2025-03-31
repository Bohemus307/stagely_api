import { FastifyInstance } from "fastify";
import { SpaceType } from "@prisma/client";
import { PropertySpaceService } from "../../../services/properties/spaces";
import { NotFoundError, ConflictError } from "../../../utils/errors";
import {
  sendNotFound,
  sendConflict,
  sendUnauthorized,
} from "../../../utils/responses";
import propertySpaceSchemas from "../../../schemas/property-space-schema";
import { PropertyService } from "../../../services/properties";

// Define route parameter types
interface ParamsWithId {
  id: string;
}

interface ParamsWithPropertyId {
  propertyId: string;
}

interface QueryParams {
  page?: string;
  limit?: string;
  propertyId?: string;
  spaceType?: SpaceType;
  aiGenerated?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

/**
 * Property Space routes
 *
 * @param fastify - The Fastify instance
 */
async function propertySpaceRoutes(fastify: FastifyInstance): Promise<void> {
  const propertySpaceService = new PropertySpaceService(
    fastify.prisma,
    fastify.s3,
  );
  const propertyService = new PropertyService(fastify.prisma);

  // GET /property-spaces
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Get a list of property spaces with optional filtering",
      summary: "List all property spaces",
      querystring: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            minimum: 1,
            default: 1,
            description: "Page number",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 10,
            description: "Number of items per page",
          },
          propertyId: {
            type: "integer",
            description: "Filter by property ID",
          },
          spaceType: {
            type: "string",
            enum: Object.values(SpaceType),
            description: "Filter by space type",
          },
          aiGenerated: {
            type: "boolean",
            description: "Filter by AI generated status",
          },
          search: {
            type: "string",
            description: "Search by name",
          },
          sortBy: {
            type: "string",
            enum: ["createdAt", "name", "type"],
            default: "createdAt",
            description: "Sort results by field",
          },
          sortOrder: {
            type: "string",
            enum: ["asc", "desc"],
            default: "desc",
            description: "Sort order (ascending or descending)",
          },
        },
      },
      response: {
        200: propertySpaceSchemas.spacesResponseSchema,
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const queryParams = request.query as QueryParams;

      const result = await propertySpaceService.getPropertySpaces({
        page: queryParams.page ? parseInt(queryParams.page) : undefined,
        limit: queryParams.limit ? parseInt(queryParams.limit) : undefined,
        propertyId: queryParams.propertyId
          ? parseInt(queryParams.propertyId)
          : undefined,
        spaceType: queryParams.spaceType,
        aiGenerated:
          queryParams.aiGenerated === "true"
            ? true
            : queryParams.aiGenerated === "false"
              ? false
              : undefined,
        search: queryParams.search,
        sortBy: queryParams.sortBy,
        sortOrder: queryParams.sortOrder as "asc" | "desc" | undefined,
      });

      return result;
    },
  });

  // GET /property-spaces/:id
  fastify.route({
    method: "GET",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Get a single property space by ID",
      summary: "Get property space details",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      response: {
        200: propertySpaceSchemas.spaceResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: {
                  type: "string",
                  example: "Property space not found",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        const space = await propertySpaceService.getSpaceById(parseInt(id));
        return space;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property space not found");
        }
        throw err;
      }
    },
  });

  // GET /property-spaces/property/:propertyId
  fastify.route({
    method: "GET",
    url: "/property/:propertyId",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Get all spaces for a specific property",
      summary: "List property spaces by property",
      params: {
        type: "object",
        properties: {
          propertyId: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property ID",
          },
        },
        required: ["propertyId"],
      },
      querystring: {
        type: "object",
        properties: {
          spaceType: {
            type: "string",
            enum: Object.values(SpaceType),
            description: "Filter by space type",
          },
          aiGenerated: {
            type: "boolean",
            description: "Filter by AI generated status",
          },
          search: {
            type: "string",
            description: "Search by name",
          },
          sortBy: {
            type: "string",
            enum: ["createdAt", "name", "type"],
            default: "createdAt",
            description: "Sort results by field",
          },
          sortOrder: {
            type: "string",
            enum: ["asc", "desc"],
            default: "desc",
            description: "Sort order (ascending or descending)",
          },
        },
      },
      response: {
        200: propertySpaceSchemas.spacesListResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { propertyId } = request.params as ParamsWithPropertyId;
      const queryParams = request.query as QueryParams;

      try {
        const spaces = await propertySpaceService.getSpacesByPropertyId(
          parseInt(propertyId),
          {
            spaceType: queryParams.spaceType,
            aiGenerated:
              queryParams.aiGenerated === "true"
                ? true
                : queryParams.aiGenerated === "false"
                  ? false
                  : undefined,
            search: queryParams.search,
            sortBy: queryParams.sortBy,
            sortOrder: queryParams.sortOrder as "asc" | "desc" | undefined,
          },
        );
        return spaces;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // POST /property-spaces/classify-auto
  fastify.route({
    method: "POST",
    url: "/classify-auto",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Create spaces and classify images automatically using AI",
      summary: "Auto-create and classify spaces",
      body: {
        type: "object",
        properties: {
          propertyId: {
            type: "integer",
            description: "Property ID to associate spaces with",
          },
          imageIds: {
            type: "array",
            items: { type: "integer" },
            description: "Array of image IDs to classify",
          },
        },
        required: ["propertyId", "imageIds"],
      },
      response: {
        200: propertySpaceSchemas.multipleClassificationResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: {
                  type: "string",
                  example: "Some images not found: 1, 2, 3",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { propertyId, imageIds } = request.body as {
        propertyId: number;
        imageIds: number[];
      };

      try {
        const results = await propertySpaceService.autoCreateAndClassifySpaces(
          propertyId,
          imageIds,
        );
        return results;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, err.message);
        }
        if (err instanceof ConflictError) {
          return sendConflict(reply, err.message);
        }
        throw err;
      }
    },
  });

  // POST /property-spaces with image URL handling
  fastify.route({
    method: "POST",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description:
        "Create a new property space with image upload and classification",
      summary: "Create property space with image",
      body: {
        type: "object",
        properties: {
          propertyId: {
            type: "integer",
            description: "Property ID to associate space with",
          },
          imageUrl: {
            type: "string",
            description: "URL of the image to upload and classify",
          },
          metadata: {
            type: "object",
            description: "Additional metadata for the image",
          },
        },
        required: ["propertyId", "imageUrl"],
      },
      response: {
        201: propertySpaceSchemas.spaceResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: { type: "string", example: "Failed to process image" },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { propertyId, imageUrl, metadata } = request.body as {
        propertyId: number;
        imageUrl: string;
        metadata?: any;
      };

      try {
        // Use the service method that encapsulates the entire workflow
        const space = await propertySpaceService.createSpaceFromImage(
          propertyId,
          imageUrl,
          metadata,
        );

        reply.code(201);
        return space;
      } catch (err) {
        console.error("Error creating space with image:", err);

        if (err instanceof NotFoundError) {
          return sendNotFound(reply, err.message);
        }
        if (err instanceof ConflictError) {
          return sendConflict(reply, err.message);
        }

        reply.code(500).send({
          error: {
            statusCode: 500,
            message: "Failed to create space with image",
          },
        });
      }
    },
  });

  // POST /spaces/:id/bulk-upload
  fastify.route({
    method: "POST",
    url: "/:id/bulk-upload",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Upload multiple images to an space at once",
      summary: "Bulk upload property space images",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                imageUrl: { type: "string" },
                caption: { type: "string", nullable: true },
                takenAt: { type: "string", format: "date-time" },
                metadata: { type: "object", nullable: true },
              },
              required: ["imageUrl", "takenAt"],
            },
          },
        },
        required: ["images"],
      },
      response: {
        201: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            count: { type: "integer" },
            images: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  imageUrl: { type: "string" },
                },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const { images } = request.body as { images: any[] };

      try {
        // First get the inspection to check property ownership
        const existingSpace = await propertySpaceService.getSpaceById(
          parseInt(id),
        );

        // Get user from auth token
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        // Get the property to verify ownership
        const property = await propertyService.getPropertyById(
          existingSpace.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to upload images to this property space",
          );
        }

        const uploadedImages = await propertySpaceService.bulkUploadSpaceImages(
          parseInt(id),
          images,
        );

        reply.code(201);
        return {
          success: true,
          count: uploadedImages.length,
          images: uploadedImages.map((img) => ({
            id: img.id,
            imageUrl: img.imageUrl,
          })),
        };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property Space not found");
        }
        throw err;
      }
    },
  });

  // PUT /property-spaces/:id
  fastify.route({
    method: "PUT",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Update an existing property space",
      summary: "Update property space",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      body: propertySpaceSchemas.updateSpaceSchema,
      response: {
        200: propertySpaceSchemas.spaceResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: {
                  type: "string",
                  example: "Property space not found",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        const space = await propertySpaceService.updateSpace(
          parseInt(id),
          request.body as any,
        );
        return space;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property space not found");
        }
        throw err;
      }
    },
  });

  // DELETE /property-spaces/:id
  fastify.route({
    method: "DELETE",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Delete a property space",
      summary: "Delete property space",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            id: { type: "integer", example: 123 },
          },
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: {
                  type: "string",
                  example: "Property space not found",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        await propertySpaceService.deleteSpace(parseInt(id));
        return { success: true, id: parseInt(id) };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property space not found");
        }
        throw err;
      }
    },
  });

  // POST /property-spaces/:id/classify
  fastify.route({
    method: "POST",
    url: "/:id/classify",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Classify a property space based on its images",
      summary: "Classify property space",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      response: {
        200: propertySpaceSchemas.classificationResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: {
                  type: "string",
                  example: "Property space not found",
                },
              },
            },
          },
        },
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: {
                  type: "string",
                  example: "Cannot classify space without associated images",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        const result = await propertySpaceService.classifySpace(parseInt(id));
        return result;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property space not found");
        }
        if (err instanceof ConflictError) {
          return sendConflict(reply, err.message);
        }
        throw err;
      }
    },
  });

  // POST /property-spaces/:id/images
  fastify.route({
    method: "POST",
    url: "/:id/images",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Associate images with a property space",
      summary: "Associate images with space",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          imageIds: {
            type: "array",
            items: { type: "integer" },
            description: "Array of image IDs to associate",
          },
        },
        required: ["imageIds"],
      },
      response: {
        204: {
          type: "null",
          description: "Images associated successfully",
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: {
                  type: "string",
                  example: "Property space not found",
                },
              },
            },
          },
        },
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: {
                  type: "string",
                  example: "Some images not found: 1, 2, 3",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const { imageIds } = request.body as { imageIds: number[] };

      try {
        await propertySpaceService.associateImagesWithSpace(
          parseInt(id),
          imageIds,
        );
        reply.code(204).send();
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property space not found");
        }
        if (err instanceof ConflictError) {
          return sendConflict(reply, err.message);
        }
        throw err;
      }
    },
  });

  // DELETE /property-spaces/:id/images
  fastify.route({
    method: "DELETE",
    url: "/:id/images",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Remove image associations from a property space",
      summary: "Remove images from space",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          imageIds: {
            type: "array",
            items: { type: "integer" },
            description: "Array of image IDs to remove",
          },
        },
        required: ["imageIds"],
      },
      response: {
        204: {
          type: "null",
          description: "Images removed successfully",
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: {
                  type: "string",
                  example: "Property space not found",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const { imageIds } = request.body as { imageIds: number[] };

      try {
        await propertySpaceService.removeImagesFromSpace(
          parseInt(id),
          imageIds,
        );
        reply.code(204).send();
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property space not found");
        }
        throw err;
      }
    },
  });

  // GET /property-spaces/:id/similar
  fastify.route({
    method: "GET",
    url: "/:id/similar",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Get similar spaces based on feature vectors",
      summary: "Get similar spaces",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property Space ID",
          },
        },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            default: 5,
            description: "Maximum number of similar spaces to return",
          },
        },
      },
      response: {
        200: propertySpaceSchemas.spacesListResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: {
                  type: "string",
                  example: "Property space not found",
                },
              },
            },
          },
        },
        409: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 409 },
                message: {
                  type: "string",
                  example:
                    "Space does not have feature vector for similarity comparison",
                },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const { limit } = request.query as { limit?: string };

      try {
        const similarSpaces = await propertySpaceService.getSimilarSpaces(
          parseInt(id),
          limit ? parseInt(limit) : undefined,
        );
        return similarSpaces;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property space not found");
        }
        if (err instanceof ConflictError) {
          return sendConflict(reply, err.message);
        }
        throw err;
      }
    },
  });

  // POST /property-spaces/property/:propertyId/reclassify
  fastify.route({
    method: "POST",
    url: "/property/:propertyId/reclassify",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["property-spaces"],
      description: "Reclassify all spaces for a property",
      summary: "Reclassify property spaces",
      params: {
        type: "object",
        properties: {
          propertyId: {
            type: "string",
            pattern: "^\\d+$",
            description: "Property ID",
          },
        },
        required: ["propertyId"],
      },
      response: {
        200: propertySpaceSchemas.multipleClassificationResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Property not found" },
              },
            },
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    handler: async (request, reply) => {
      const { propertyId } = request.params as ParamsWithPropertyId;

      try {
        const results = await propertySpaceService.reclassifyPropertySpaces(
          parseInt(propertyId),
        );
        return results;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });
}

export default propertySpaceRoutes;
