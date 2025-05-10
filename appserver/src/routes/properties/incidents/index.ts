import { FastifyInstance } from "fastify";
import { IncidentStatus, IncidentSeverity, SpaceType } from "@prisma/client";
import { NotFoundError } from "../../../utils/errors";

import { sendNotFound, sendUnauthorized } from "../../../utils/responses";
import { IncidentService } from "../../../services/incidents";

// Define route parameter types
interface ParamsWithId {
  id: string;
}

interface StatusUpdateBody {
  status: IncidentStatus;
  resolvedAt?: string | null;
}

/**
 * Incident routes
 *
 * @param fastify - The Fastify instance
 */
async function incidentRoutes(fastify: FastifyInstance): Promise<void> {
  // Get service instance with Prisma
  const incidentService = new IncidentService(fastify.prisma, fastify.s3);

  // GET /incidents
  fastify.route({
    method: "GET",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Get a list of incidents with optional filtering",
      summary: "List all incidents",
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
          status: {
            type: "string",
            enum: Object.values(IncidentStatus),
            description: "Filter by incident status",
          },
          severity: {
            type: "string",
            enum: Object.values(IncidentSeverity),
            description: "Filter by incident severity",
          },
          spaceType: {
            type: "string",
            enum: Object.values(SpaceType),
            description: "Filter by space type",
          },
          incidentType: {
            type: "string",
            description: "Filter by incident type",
          },
          fromDate: {
            type: "string",
            format: "date-time",
            description: "Filter incidents reported after this date",
          },
          toDate: {
            type: "string",
            format: "date-time",
            description: "Filter incidents reported before this date",
          },
          sortBy: {
            type: "string",
            enum: ["reportedAt", "resolvedAt", "severity", "status"],
            default: "reportedAt",
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
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  propertyId: { type: "integer" },
                  incidentType: { type: "string" },
                  description: { type: "string" },
                  reportedAt: { type: "string", format: "date-time" },
                  resolvedAt: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  severity: {
                    type: "string",
                    enum: Object.values(IncidentSeverity),
                  },
                  status: {
                    type: "string",
                    enum: Object.values(IncidentStatus),
                  },
                  spaceType: {
                    type: "string",
                    enum: Object.values(SpaceType),
                    nullable: true,
                  },
                  aiClassified: { type: "boolean" },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                  property: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      address: { type: "string" },
                      city: { type: "string" },
                      state: { type: "string", nullable: true },
                      zipCode: { type: "string", nullable: true },
                      country: { type: "string" },
                      status: {
                        type: "string",
                        enum: ["Active", "Maintenance", "Archived"],
                      },
                    },
                  },
                  images: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        imageUrl: { type: "string" },
                        caption: { type: "string", nullable: true },
                        takenAt: { type: "string", format: "date-time" },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                  objectLabels: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        name: { type: "string" },
                        confidence: { type: "number" },
                        category: { type: "string", nullable: true },
                      },
                    },
                  },
                },
              },
            },
            meta: {
              type: "object",
              properties: {
                page: { type: "integer" },
                limit: { type: "integer" },
                total: { type: "integer" },
                totalPages: { type: "integer" },
              },
            },
          },
        },
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

      // Get the properties that belong to this user
      const userProperties = await fastify.prisma.property.findMany({
        where: { userId: user.id },
        select: { id: true },
      });

      const propertyIds = userProperties.map((p) => p.id);

      // Add propertyIds to query params to restrict to user's properties
      const queryParams = {
        ...(request.query as any),
        propertyId: (request.query as any).propertyId
          ? parseInt((request.query as any).propertyId)
          : undefined,
      };

      // Verify the requested propertyId belongs to the user if specified
      if (
        queryParams.propertyId &&
        !propertyIds.includes(queryParams.propertyId)
      ) {
        return sendUnauthorized(
          reply,
          "You don't have permission to access this property's incidents",
        );
      }

      // If no specific property is requested, limit to all user properties
      if (!queryParams.propertyId) {
        queryParams.propertyIds = propertyIds;
      }

      const result = await incidentService.getIncidents(queryParams);
      return result;
    },
  });

  // GET /incidents/:id
  fastify.route({
    method: "GET",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Get a single incident by ID",
      summary: "Get incident details",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Incident ID" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "integer" },
            propertyId: { type: "integer" },
            incidentType: { type: "string" },
            description: { type: "string" },
            reportedAt: { type: "string", format: "date-time" },
            resolvedAt: { type: "string", format: "date-time", nullable: true },
            severity: {
              type: "string",
              enum: Object.values(IncidentSeverity),
            },
            status: {
              type: "string",
              enum: Object.values(IncidentStatus),
            },
            spaceType: {
              type: "string",
              enum: Object.values(SpaceType),
              nullable: true,
            },
            aiClassified: { type: "boolean" },
            featureVector: { type: "object", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            property: {
              type: "object",
              properties: {
                id: { type: "integer" },
                address: { type: "string" },
                city: { type: "string" },
                state: { type: "string", nullable: true },
                zipCode: { type: "string", nullable: true },
                country: { type: "string" },
                status: {
                  type: "string",
                  enum: ["Active", "Maintenance", "Archived"],
                },
                userId: { type: "integer" },
              },
            },
            images: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  imageUrl: { type: "string" },
                  caption: { type: "string", nullable: true },
                  takenAt: { type: "string", format: "date-time" },
                  metadata: { type: "object", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                },
              },
            },
            objectLabels: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  name: { type: "string" },
                  confidence: { type: "number" },
                  category: { type: "string", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                },
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
                message: { type: "string", example: "Incident not found" },
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
        const incident = await incidentService.getIncidentById(parseInt(id));

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        // Get the property to check ownership
        const property = await fastify.prisma.property.findUnique({
          where: { id: incident.propertyId },
          select: { userId: true },
        });

        if (!user || !property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this incident",
          );
        }

        return incident;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Incident not found");
        }
        throw err;
      }
    },
  });

  // PUT /incidents/:id
  fastify.route({
    method: "PUT",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Update an existing incident",
      summary: "Update incident",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Incident ID" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          incidentType: { type: "string" },
          description: { type: "string" },
          reportedAt: { type: "string", format: "date-time" },
          resolvedAt: { type: "string", format: "date-time", nullable: true },
          severity: {
            type: "string",
            enum: Object.values(IncidentSeverity),
          },
          status: {
            type: "string",
            enum: Object.values(IncidentStatus),
          },
          spaceType: {
            type: "string",
            enum: Object.values(SpaceType),
            nullable: true,
          },
          aiClassified: {
            type: "boolean",
          },
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                imageUrl: { type: "string" },
                caption: { type: "string", nullable: true },
                takenAt: { type: "string", format: "date-time" },
                metadata: { type: "object", nullable: true },
              },
              required: ["imageUrl", "takenAt"],
            },
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "integer" },
            propertyId: { type: "integer" },
            incidentType: { type: "string" },
            description: { type: "string" },
            reportedAt: { type: "string", format: "date-time" },
            resolvedAt: { type: "string", format: "date-time", nullable: true },
            severity: {
              type: "string",
              enum: Object.values(IncidentSeverity),
            },
            status: {
              type: "string",
              enum: Object.values(IncidentStatus),
            },
            spaceType: {
              type: "string",
              enum: Object.values(SpaceType),
              nullable: true,
            },
            aiClassified: { type: "boolean" },
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
                message: { type: "string", example: "Incident not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const incidentData = request.body as any;

      try {
        // First check if incident exists
        const existingIncident = await incidentService.getIncidentById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        // Get the property to check ownership
        const property = await fastify.prisma.property.findUnique({
          where: { id: existingIncident.propertyId },
          select: { userId: true },
        });

        if (!user || !property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to update this incident",
          );
        }

        const incident = await incidentService.updateIncident(
          parseInt(id),
          incidentData,
        );

        return incident;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Incident not found");
        }
        throw err;
      }
    },
  });

  // PATCH /incidents/:id/status
  fastify.route({
    method: "PATCH",
    url: "/:id/status",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Update incident status",
      summary: "Change incident status",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Incident ID" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: Object.values(IncidentStatus),
            description: "New incident status",
          },
          resolvedAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            description:
              "Resolution date (required if status is Resolved or Closed)",
          },
        },
        required: ["status"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "integer" },
            propertyId: { type: "integer" },
            incidentType: { type: "string" },
            description: { type: "string" },
            reportedAt: { type: "string", format: "date-time" },
            resolvedAt: { type: "string", format: "date-time", nullable: true },
            severity: {
              type: "string",
              enum: Object.values(IncidentSeverity),
            },
            status: {
              type: "string",
              enum: Object.values(IncidentStatus),
            },
            spaceType: {
              type: "string",
              enum: Object.values(SpaceType),
              nullable: true,
            },
            aiClassified: { type: "boolean" },
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
                message: { type: "string", example: "Incident not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const { status, resolvedAt } = request.body as StatusUpdateBody;

      try {
        // First check if incident exists
        const existingIncident = await incidentService.getIncidentById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        // Get the property to check ownership
        const property = await fastify.prisma.property.findUnique({
          where: { id: existingIncident.propertyId },
          select: { userId: true },
        });

        if (!user || !property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to update this incident",
          );
        }

        const incident = await incidentService.changeIncidentStatus(
          parseInt(id),
          status,
          resolvedAt,
        );

        return incident;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Incident not found");
        }
        throw err;
      }
    },
  });

  // DELETE /incidents/:id
  fastify.route({
    method: "DELETE",
    url: "/:id",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Delete an incident",
      summary: "Delete incident",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Incident ID" },
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
                message: { type: "string", example: "Incident not found" },
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
        // First check if incident exists
        const existingIncident = await incidentService.getIncidentById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        // Get the property to check ownership
        const property = await fastify.prisma.property.findUnique({
          where: { id: existingIncident.propertyId },
          select: { userId: true },
        });

        if (!user || !property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to delete this incident",
          );
        }

        const result = await incidentService.deleteIncident(parseInt(id));
        return result;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Incident not found");
        }
        throw err;
      }
    },
  });

  // POST /incidents/:id/images
  fastify.route({
    method: "POST",
    url: "/:id/images",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Add images to an incident",
      summary: "Add incident images",
      params: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^\\d+$", description: "Incident ID" },
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
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              incidentId: { type: "integer" },
              imageUrl: { type: "string" },
              caption: { type: "string", nullable: true },
              takenAt: { type: "string", format: "date-time" },
              metadata: { type: "object", nullable: true },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
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
                message: { type: "string", example: "Incident not found" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as ParamsWithId;
      const { images } = request.body as {
        images: {
          imageUrl: string;
          caption?: string;
          takenAt: string;
          metadata?: object;
        }[];
      };

      try {
        // First check if incident exists
        const existingIncident = await incidentService.getIncidentById(
          parseInt(id),
        );

        // Verify property belongs to authenticated user
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        // Get the property to check ownership
        const property = await fastify.prisma.property.findUnique({
          where: { id: existingIncident.propertyId },
          select: { userId: true },
        });

        if (!user || !property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to update this incident",
          );
        }

        const result = await incidentService.addIncidentImages(
          parseInt(id),
          images,
        );
        return result;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, "Incident not found");
        }
        throw err;
      }
    },
  });

  // GET /incidents/stats
  fastify.route({
    method: "GET",
    url: "/stats",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Get statistics about incidents",
      summary: "Incident statistics",
      querystring: {
        type: "object",
        properties: {
          propertyId: {
            type: "integer",
            description: "Filter statistics by property ID",
          },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            byStatus: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    enum: Object.values(IncidentStatus),
                  },
                  _count: { type: "integer" },
                },
              },
            },
            bySeverity: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: {
                    type: "string",
                    enum: Object.values(IncidentSeverity),
                  },
                  _count: { type: "integer" },
                },
              },
            },
            bySpaceType: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  spaceType: {
                    type: "string",
                    enum: Object.values(SpaceType),
                  },
                  _count: { type: "integer" },
                },
              },
            },
            topIncidentTypes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  incidentType: { type: "string" },
                  _count: { type: "integer" },
                },
              },
            },
            avgResolutionTime: { type: "number" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { propertyId } = request.query as { propertyId?: string };
      const parsedPropertyId = propertyId ? parseInt(propertyId) : undefined;

      // Get user from auth token
      const user = await fastify.prisma.user.findUnique({
        where: { auth0Id: request?.user?.sub },
      });

      if (!user) {
        return sendUnauthorized(reply, "User not found");
      }

      // If propertyId is specified, verify it belongs to the user
      if (parsedPropertyId) {
        const property = await fastify.prisma.property.findUnique({
          where: { id: parsedPropertyId },
          select: { userId: true },
        });

        if (!property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to access this property's statistics",
          );
        }
      } else {
        // If no propertyId is specified, we need to restrict stats to user's properties
        // Get all user's property IDs
        const userProperties = await fastify.prisma.property.findMany({
          where: { userId: user.id },
          select: { id: true },
        });

        const propertyIds = userProperties.map((p) => p.id);

        // If user has no properties, return empty stats
        if (propertyIds.length === 0) {
          return {
            byStatus: [],
            bySeverity: [],
            bySpaceType: [],
            topIncidentTypes: [],
            avgResolutionTime: 0,
          };
        }

        // The repository now supports filtering by multiple property IDs
      }

      const stats = await incidentService.getIncidentStats(parsedPropertyId);
      return stats;
    },
  });

  // POST /incidents
  fastify.route({
    method: "POST",
    url: "/",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Create a new incident with optional AI analysis",
      summary: "Create incident",
      body: {
        type: "object",
        properties: {
          propertyId: { type: "integer" },
          incidentType: { type: "string" },
          description: { type: "string" },
          reportedAt: { type: "string", format: "date-time" },
          severity: {
            type: "string",
            enum: Object.values(IncidentSeverity),
          },
          spaceType: {
            type: "string",
            enum: Object.values(SpaceType),
            nullable: true,
          },
          status: {
            type: "string",
            enum: Object.values(IncidentStatus),
          },
          imageUrl: { type: "string" },
          metadata: { type: "object" },
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
              required: ["imageUrl"],
            },
          },
        },
        required: ["propertyId"],
        anyOf: [
          { required: ["imageUrl"] },
          { required: ["incidentType", "description", "severity"] },
        ],
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "integer" },
            propertyId: { type: "integer" },
            incidentType: { type: "string" },
            description: { type: "string" },
            reportedAt: { type: "string", format: "date-time" },
            resolvedAt: { type: "string", format: "date-time", nullable: true },
            severity: {
              type: "string",
              enum: Object.values(IncidentSeverity),
            },
            status: {
              type: "string",
              enum: Object.values(IncidentStatus),
            },
            spaceType: {
              type: "string",
              enum: Object.values(SpaceType),
              nullable: true,
            },
            aiClassified: { type: "boolean" },
            labeledImageUrl: {
              type: "string",
              nullable: true,
              description: "URL to the image with AI-detected bounding boxes",
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const incidentData = request.body as any;

      try {
        // Get user from auth token
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        // Verify the property belongs to the user
        const property = await fastify.prisma.property.findUnique({
          where: { id: incidentData.propertyId },
          select: { userId: true, id: true },
        });

        if (!property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to add an incident to this property",
          );
        }

        let incident;

        // If imageUrl is provided, use the AI classification flow
        if (incidentData.imageUrl) {
          try {
            incident = await incidentService.createIncidentFromImage(
              property.id,
              incidentData.imageUrl,
              user.id.toString(),
              incidentData.metadata,
            );
          } catch (error) {
            fastify.log.error("Error during AI classification:", error);

            // Fall back to normal creation if AI classification fails
            return reply.code(400).send({
              error: {
                statusCode: 400,
                message:
                  "Failed to create incident from image. Please try using the standard creation method.",
              },
            });
          }
        }
        // Otherwise use the standard create incident flow
        else {
          // Validate required fields for regular creation
          if (
            !incidentData.incidentType ||
            !incidentData.description ||
            !incidentData.severity
          ) {
            return reply.code(400).send({
              error: {
                statusCode: 400,
                message:
                  "When not providing an image URL, you must include incidentType, description, and severity",
              },
            });
          }

          // Ensure images have takenAt date if present
          if (incidentData.images && incidentData.images.length > 0) {
            incidentData.images = incidentData.images.map(
              (img: { takenAt: any }) => ({
                ...img,
                takenAt: img.takenAt || new Date().toISOString(),
              }),
            );
          }

          incident = await incidentService.createIncident({
            propertyId: property.id,
            incidentType: incidentData.incidentType,
            description: incidentData.description,
            reportedAt: incidentData.reportedAt,
            severity: incidentData.severity,
            status: incidentData.status || IncidentStatus.Open,
            images: incidentData.images,
          });
        }

        reply.code(201);
        return incident;
      } catch (err: any) {
        fastify.log.error(err);

        // Handle specific errors with appropriate responses
        if (err instanceof NotFoundError) {
          return reply.code(404).send({
            error: {
              statusCode: 404,
              message: err.message,
            },
          });
        }

        throw err;
      }
    },
  });

  // POST /incidents/classify
  fastify.route({
    method: "POST",
    url: "/classify-images",
    onRequest: [fastify.authenticate],
    schema: {
      tags: ["incidents"],
      description: "Classify existing images to create incidents",
      summary: "Create incidents from existing images",
      body: {
        type: "object",
        properties: {
          propertyId: { type: "integer" },
          imageIds: {
            type: "array",
            items: { type: "integer" },
          },
        },
        required: ["propertyId", "imageIds"],
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              incidentId: { type: "integer" },
              spaceType: {
                type: "string",
                enum: Object.values(SpaceType),
              },
              confidenceScore: { type: "number" },
              objectLabels: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { propertyId, imageIds } = request.body as {
        propertyId: number;
        imageIds: number[];
      };

      try {
        // Verify user owns the property
        const user = await fastify.prisma.user.findUnique({
          where: { auth0Id: request?.user?.sub },
        });

        if (!user) {
          return sendUnauthorized(reply, "User not found");
        }

        const property = await fastify.prisma.property.findUnique({
          where: { id: propertyId },
          select: { userId: true },
        });

        if (!property || property.userId !== user.id) {
          return sendUnauthorized(
            reply,
            "You don't have permission to classify images for this property",
          );
        }

        // Use the autoCreateAndClassifyIncident method to create incidents from images
        const results = await incidentService.autoCreateAndClassifyIncident(
          propertyId,
          imageIds,
        );

        return results;
      } catch (err) {
        fastify.log.error("Error classifying images:", err);
        if (err instanceof NotFoundError) {
          return sendNotFound(reply, err.message);
        }
        throw err;
      }
    },
  });
}

export default incidentRoutes;
