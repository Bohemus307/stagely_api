import { FastifyInstance } from "fastify";
import { PropertyService } from "../../../services/properties";
import { InspectionService } from "../../../services/properties/inspections";
import { NotFoundError } from "../../../utils/errors";
import { sendUnauthorized, sendNotFound } from "../../../utils/responses";
import {
  classifyImagesSchema,
  createInspectionSchema,
  inspectionResponseSchema,
  inspectionsResponseSchema,
  updateInspectionSchema,
  uploadImageSchema,
} from "../../../schemas/inspection-schema";
import { EventService } from "../../../services/eventService";
import { DynamoDBEventRepository } from "../../../repositories/dynamoDB/eventsRepository";
import { UserRepository } from "../../../repositories/userRepository";
import { getEventMetadata, getChangedFields } from "../../../utils/eventHelpers";

// Define route parameter types
interface ParamsWithId {
  id: string;
}

interface PropertyIdParams {
  propertyId: string;
}

/**
 * Inspection routes
 *
 * @param fastify - The Fastify instance
 */
async function inspectionRoutes(fastify: FastifyInstance): Promise<void> {
  // Get service instances with Prisma
  const inspectionService = new InspectionService(fastify.prisma);
  const propertyService = new PropertyService(fastify.prisma);
  const eventService = new EventService(
        new DynamoDBEventRepository(
            fastify.dynamoDB.documentClient,
            process.env.NODE_ENV || 'staging'
        ),
        new UserRepository(fastify.prisma)
    );

  // GET /inspections
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Get a list of inspections with optional filtering",
      summary: "List all inspections",
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
          startDate: {
            type: "string",
            format: "date-time",
            description: "Filter by start date (ISO 8601)",
          },
          endDate: {
            type: "string",
            format: "date-time",
            description: "Filter by end date (ISO 8601)",
          },
          search: {
            type: "string",
            description: "Search term for inspection title or description",
          },
          sortBy: {
            type: "string",
            enum: ["inspectionDate", "createdAt", "updatedAt", "title"],
            default: "inspectionDate",
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
        200: inspectionsResponseSchema,
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // If propertyId is provided, verify ownership
      const queryParams = request.query as any;
      if (queryParams.propertyId) {
        try {
          const property = await propertyService.getPropertyById(
            parseInt(queryParams.propertyId),
          );

          if (property.userId !== user.id) {
            return sendUnauthorized(
              reply,
              "You don't have permission to access inspections for this property",
            );
          }
        } catch (err) {
          if (err instanceof NotFoundError) {
            return sendNotFound(reply, "Property not found");
          }
          throw err;
        }
      } else {
        // If no propertyId is provided, get all user's properties
        const userProperties = await fastify.prisma.property.findMany({
          where: { userId: user.id },
          select: { id: true },
        });

        if (userProperties.length === 0) {
          // Return empty result if user has no properties
          return {
            data: [],
            meta: {
              page: 1,
              limit: 10,
              total: 0,
              totalPages: 0,
            },
          };
        }

        // Filter inspections by user's properties
        queryParams.propertyId = {
          in: userProperties.map((prop) => prop.id),
        };
      }

      const result = await inspectionService.getInspections(queryParams);
      return result;
    },
  });

  // GET /inspections/:id
  fastify.route({
    method: "GET",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Get a single inspection by ID",
      summary: "Get inspection details",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Inspection ID",
          },
        },
        required: ["id"],
      },
      response: {
        200: inspectionResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Inspection not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        const inspection = await inspectionService.getInspectionById(
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
          inspection.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this inspection",
          );
        }

        // Log inspection viewed
        setImmediate(async () => {
      try {
        await eventService.logInspectionViewed(
          user.id,
          inspection.id,
          inspection.propertyId,
          inspection.title,
          getEventMetadata(request)
        );
      } catch (error) {
        fastify.log.error('Failed to log inspection view:', error);
      }
    });

        return inspection;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Inspection not found");
        }
        throw err;
      }
    },
  });

  // POST /inspections
  fastify.route({
    method: "POST",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Create a new inspection",
      summary: "Create inspection",
      body: createInspectionSchema,
      response: {
        201: inspectionResponseSchema,
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const inspectionData = request.body as any;

      try {
        // Get user from auth token
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        // Verify property belongs to authenticated user
        const property = await propertyService.getPropertyById(
          inspectionData.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to create an inspection for this property",
          );
        }

        const inspection =
          await inspectionService.createInspection(inspectionData);

        reply.code(201);
        return inspection;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });

  // PUT /inspections/:id
  fastify.route({
    method: "PUT",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Update an existing inspection",
      summary: "Update inspection",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Inspection ID",
          },
        },
        required: ["id"],
      },
      body: updateInspectionSchema,
      response: {
        200: inspectionResponseSchema,
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Inspection not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const updateData = request.body as any;

      try {
        // First get the inspection to check property ownership
        const existingInspection = await inspectionService.getInspectionById(
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
          existingInspection.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to update this inspection",
          );
        }

        const updatedInspection = await inspectionService.updateInspection(
          parseInt(id),
          updateData,
        );

        // ✅ CRITICAL EVENT: Check if inspection was completed
        if (updateData.status === 'COMPLETED' || updateData.completed === true) {
          // Get photo count using the correct method
          const inspectionImages = await inspectionService.getInspectionImages(parseInt(id));
          const photoCount = inspectionImages.length;

          setImmediate(async () => {
            try {
              await eventService.logInspectionCompleted(
                user.id,
                parseInt(id),
                existingInspection.propertyId,
                existingInspection.title,
                photoCount,
                getEventMetadata(request)
              );
            } catch (error) {
              fastify.log.error('Failed to log inspection completed event:', error);
            }
          });
        }

        return updatedInspection;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Inspection not found");
        }
        throw err;
      }
    },
  });

  // DELETE /inspections/:id
  fastify.route({
    method: "DELETE",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Delete an inspection",
      summary: "Delete inspection",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Inspection ID",
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
                message: { type: "string", example: "Inspection not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        // First get the inspection to check property ownership
        const existingInspection = await inspectionService.getInspectionById(
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
          existingInspection.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to delete this inspection",
          );
        }

        await inspectionService.deleteInspection(parseInt(id));

        return { success: true, id: parseInt(id) };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Inspection not found");
        }
        throw err;
      }
    },
  });

  // POST /inspections/:id/images
  fastify.route({
    method: "POST",
    url: "/:id/images",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Upload an image to an inspection",
      summary: "Upload inspection image",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Inspection ID",
          },
        },
        required: ["id"],
      },
      body: uploadImageSchema,
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "integer" },
            inspectionId: { type: "integer" },
            imageUrl: { type: "string" },
            caption: { type: "string", nullable: true },
            takenAt: { type: "string", format: "date-time" },
            spaceId: { type: "integer", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Inspection not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const imageData = request.body as any;

      try {
        // First get the inspection to check property ownership
        const existingInspection = await inspectionService.getInspectionById(
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
          existingInspection.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to upload images to this inspection",
          );
        }

        const uploadedImage = await inspectionService.uploadInspectionImage({
          ...imageData,
          inspectionId: parseInt(id),
        });

        // ✅ CAPTURE VALUES
        const capturedUserId = user?.id;
        const capturedInspectionId = parseInt(id);
        const capturedPropertyId = existingInspection?.propertyId;
        const capturedImageUrl = imageData?.imageUrl;
        const capturedSpaceType = imageData?.spaceType || 'Unknown';

        // Log inspection photo uploaded
        setImmediate(async () => {
          try {

            await eventService.logInspectionPhotoUploaded(
              capturedUserId,
              capturedInspectionId,
              capturedPropertyId,
              capturedImageUrl,
              capturedSpaceType
            );
          } catch (error) {
            fastify.log.error('❌ ERROR: Failed to log inspection photo upload:', error);
          }
        });

        reply.code(201);
        return uploadedImage;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Inspection not found");
        }
        throw err;
      }
    },
  });

  // POST /inspections/:id/bulk-upload // need this in spaces as well!!!!
  fastify.route({
    method: "POST",
    url: "/:id/bulk-upload",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Upload multiple images to an inspection at once",
      summary: "Bulk upload inspection images",
      params: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^\\d+$",
            description: "Inspection ID",
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
        const existingInspection = await inspectionService.getInspectionById(
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
          existingInspection.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to upload images to this inspection",
          );
        }

        const uploadedImages = await inspectionService.bulkUploadImages(
          parseInt(id),
          images,
        );

        // Log bulk photos uploaded for progress tracking
        setImmediate(async () => {
          try {
            const uploadedBytes = images.length * 2000000; // Rough estimate: 2MB per image
            await eventService.logInspectionBulkPhotosUploaded(
              user.id,
              parseInt(id),
              existingInspection.propertyId,
              images.length,
              uploadedBytes,
              //getEventMetadata(request)
            );
          } catch (error) {
            fastify.log.error('Failed to log bulk photo upload:', error);
          }
        });

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
          return sendNotFound(reply, "Inspection not found");
        }
        throw err;
      }
    },
  });

  // PUT /inspections/images/:id
  fastify.route({
    method: "PUT",
    url: "/images/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Update inspection image details",
      summary: "Update inspection image",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Image ID" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          caption: { type: "string", nullable: true },
          spaceId: { type: "integer", nullable: true },
          metadata: { type: "object", nullable: true },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "integer" },
            inspectionId: { type: "integer" },
            imageUrl: { type: "string" },
            caption: { type: "string", nullable: true },
            takenAt: { type: "string", format: "date-time" },
            spaceId: { type: "integer", nullable: true },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Image not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const updateData = request.body as any;

      try {
        // First, we need to get the image to find its inspection
        const images = await inspectionService.getInspectionImages(
          parseInt(id),
        );
        const image = images.find((img) => img.id === parseInt(id));

        if (!image || !image.inspectionId) {
          return sendNotFound(reply, "Image not found");
        }

        // Then get the inspection to check property ownership
        const inspection = await inspectionService.getInspectionById(
          image.inspectionId,
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
          inspection.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to update this image",
          );
        }

        const updatedImage = await inspectionService.updateInspectionImage(
          parseInt(id),
          updateData,
        );

        return updatedImage;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Image or inspection not found");
        }
        throw err;
      }
    },
  });

  // DELETE /inspections/images/:id
  fastify.route({
    method: "DELETE",
    url: "/images/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Delete an inspection image",
      summary: "Delete inspection image",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Image ID" },
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
                message: { type: "string", example: "Image not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;

      try {
        // First, we need to get the image to find its inspection
        const images = await inspectionService.getInspectionImages(
          parseInt(id),
        );
        const image = images.find((img) => img.id === parseInt(id));

        if (!image || !image.inspectionId) {
          return sendNotFound(reply, "Image not found");
        }

        // Then get the inspection to check property ownership
        const inspection = await inspectionService.getInspectionById(
          image.inspectionId,
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
          inspection.propertyId,
        );

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to delete this image",
          );
        }

        await inspectionService.deleteInspectionImage(parseInt(id));

        return { success: true, id: parseInt(id) };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Image or inspection not found");
        }
        throw err;
      }
    },
  });

  // POST /inspections/classify-images
  fastify.route({
    method: "POST",
    url: "/classify-images",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Classify multiple images to a space",
      summary: "Classify images to space",
      body: classifyImagesSchema,
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            count: { type: "integer", example: 5 },
          },
        },
        404: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                statusCode: { type: "number", example: 404 },
                message: { type: "string", example: "Space not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { imageIds, spaceId } = request.body as {
        imageIds: number[];
        spaceId: number;
      };

      try {
        // First we need to verify the user owns the property with this space
        // Get the space details to find the property
        const space = await fastify.prisma.propertySpace.findUnique({
          where: { id: spaceId },
          include: { property: true },
        });

        if (!space) {
          return sendNotFound(reply, "Property space not found");
        }

        // Get user from auth token
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        // Check if user owns the property
        if (space.property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to classify images to this space",
          );
        }

        // Then we need to verify the user owns all the images
        // Get all images and their associated properties
        const images = await fastify.prisma.propertyImage.findMany({
          where: { id: { in: imageIds } },
          include: {
            inspection: {
              include: {
                property: true,
              },
            },
          },
        });

        // Check if all images exist and belong to the user
        if (images.length !== imageIds.length) {
          return sendNotFound(reply, "One or more images not found");
        }

        // Verify user owns all images
        for (const image of images) {
          if (
            image.inspection &&
            image.inspection.property.userId !== user.id
          ) {
            return sendUnauthorized(
              reply,
              "You don't have permission to classify one or more of these images",
            );
          }
        }

        const count = await inspectionService.classifyImagesToSpace({
          imageIds,
          spaceId,
        });


        return { success: true, count };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, err.message);
        }
        throw err;
      }
    },
  });

  // GET /inspections/property/:propertyId/stats
  fastify.route({
    method: "GET",
    url: "/property/:propertyId/stats",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["inspections"],
      description: "Get inspection statistics for a property",
      summary: "Property inspection statistics",
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
        200: {
          type: "object",
          properties: {
            totalInspections: { type: "integer", example: 5 },
            totalImages: { type: "integer", example: 42 },
            lastInspectionDate: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            imagesByType: {
              type: "object",
              additionalProperties: { type: "integer" },
              example: {
                Kitchen: 12,
                Bathroom: 15,
                Bedroom: 8,
              },
            },
          },
        },
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
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { propertyId } = request.params as PropertyIdParams;

      try {
        // First check if property exists and belongs to user
        const property = await propertyService.getPropertyById(
          parseInt(propertyId),
        );

        // Get user from auth token
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        if (property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this property's statistics",
          );
        }

        const stats = await inspectionService.getPropertyInspectionStats(
          parseInt(propertyId),
        );

        return stats;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Property not found");
        }
        throw err;
      }
    },
  });
}

export default inspectionRoutes;
