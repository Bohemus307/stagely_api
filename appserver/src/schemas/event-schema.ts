import { EventType, EventCategory } from '../repositories/dynamoDB/eventsRepository';

// Base event metadata schema
const eventMetadataSchema = {
  type: "object",
  properties: {
    ipAddress: { type: "string", nullable: true },
    userAgent: { type: "string", nullable: true },
    source: {
      type: "string",
      enum: ["web", "mobile", "api", "system", "test"],
      description: "Source of the event"
    },
    deviceId: { type: "string", nullable: true },
    version: { type: "string", nullable: true },
    performanceMetrics: {
      type: "object",
      properties: {
        duration: { type: "number", description: "Duration in milliseconds" },
        memoryUsage: { type: "number", description: "Memory usage in bytes" },
        queryCount: { type: "number", description: "Number of database queries" },
        cacheHit: { type: "boolean", description: "Whether cache was hit" }
      },
      nullable: true,
      additionalProperties: false
    }
  },
  additionalProperties: false
};

// Event payload schemas for different event types
const propertyViewedPayloadSchema = {
  type: "object",
  properties: {
    propertyId: { type: "number" },
    propertyAddress: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    prefetchHints: {
      type: "object",
      properties: {
        incidents: { type: "boolean" },
        inspections: { type: "boolean" },
        images: { type: "boolean" },
        stats: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  required: ["propertyId", "propertyAddress"],
  additionalProperties: true
};

const incidentStatusChangedPayloadSchema = {
  type: "object",
  properties: {
    incidentId: { type: "number" },
    propertyId: { type: "number" },
    oldStatus: { type: "string" },
    newStatus: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    uiUpdateHints: {
      type: "object",
      properties: {
        refreshIncidentList: { type: "boolean" },
        updateIncidentDetail: { type: "boolean" },
        refreshPropertyStats: { type: "boolean" },
        priorityChanged: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  required: ["incidentId", "propertyId", "oldStatus", "newStatus"],
  additionalProperties: true
};

const inspectionBulkPhotosPayloadSchema = {
  type: "object",
  properties: {
    inspectionId: { type: "number" },
    propertyId: { type: "number" },
    photoCount: { type: "number" },
    uploadedBytes: { type: "number" },
    timestamp: { type: "string", format: "date-time" },
    progressHints: {
      type: "object",
      properties: {
        totalPhotos: { type: "number" },
        completedPhotos: { type: "number" },
        totalBytes: { type: "number" },
        processingRequired: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  required: ["inspectionId", "propertyId", "photoCount", "uploadedBytes"],
  additionalProperties: true
};

// Base event schema with common properties
const eventBaseSchema = {
  type: "object",
  properties: {
    eventId: { type: "string", description: "Unique event identifier" },
    userId: { type: "number", description: "ID of the user who triggered the event" },
    eventType: {
      type: "string",
      enum: Object.values(EventType),
      description: "Type of event"
    },
    category: {
      type: "string",
      enum: Object.values(EventCategory),
      description: "Category of event"
    },
    timestamp: { type: "number", description: "Event timestamp in milliseconds" },
    title: { type: "string", description: "Human-readable event title" },
    description: { type: "string", description: "Event description" },
    payload: {
      type: "object",
      description: "Event-specific data",
      additionalProperties: true
    },
    metadata: eventMetadataSchema,
    relatedEntityId: {
      type: "string",
      nullable: true,
      description: "ID of related entity (property, incident, etc.)"
    },
    relatedEntityType: {
      type: "string",
      nullable: true,
      description: "Type of related entity"
    }
  }
};

// Schema for creating a new event
export const createEventSchema = {
  type: "object",
  properties: {
    eventType: {
      type: "string",
      enum: Object.values(EventType),
      description: "Type of event to create"
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "Event title"
    },
    description: {
      type: "string",
      minLength: 1,
      maxLength: 1000,
      description: "Event description"
    },
    payload: {
      type: "object",
      description: "Event-specific data",
      additionalProperties: true
    },
    metadata: eventMetadataSchema,
    relatedEntityId: {
      type: "string",
      nullable: true,
      description: "ID of related entity"
    },
    relatedEntityType: {
      type: "string",
      nullable: true,
      enum: ["property", "incident", "inspection", "user"],
      description: "Type of related entity"
    }
  },
  required: ["eventType", "title", "description", "payload"],
  additionalProperties: false
};

// Schema for test event creation (simpler)
export const createTestEventSchema = {
  type: "object",
  properties: {
    eventType: {
      type: "string",
      enum: Object.values(EventType),
      default: EventType.PROPERTY_VIEWED,
      description: "Type of test event to create"
    },
    title: {
      type: "string",
      default: "Test Event",
      description: "Test event title"
    },
    description: {
      type: "string",
      default: "Testing event creation",
      description: "Test event description"
    },
    payload: {
      type: "object",
      default: { test: true },
      description: "Test event payload",
      additionalProperties: true
    }
  },
  additionalProperties: false
};

// Schema for event query parameters
export const eventQuerySchema = {
  type: "object",
  properties: {
    eventTypes: {
      type: "array",
      items: {
        type: "string",
        enum: Object.values(EventType)
      },
      description: "Filter by event types"
    },
    categories: {
      type: "array",
      items: {
        type: "string",
        enum: Object.values(EventCategory)
      },
      description: "Filter by event categories"
    },
    startTime: {
      type: "number",
      description: "Start timestamp for filtering events"
    },
    endTime: {
      type: "number",
      description: "End timestamp for filtering events"
    },
    limit: {
      type: "number",
      default: 50,
      minimum: 1,
      maximum: 100,
      description: "Maximum number of events to return"
    },
    lastEvaluatedKey: {
      type: "string",
      description: "Pagination key for next batch of events"
    }
  },
  additionalProperties: false
};

// Schema for single event response
export const eventResponseSchema = {
  ...eventBaseSchema,
  properties: {
    ...eventBaseSchema.properties,
    createdAt: { type: "string", format: "date-time", description: "When event was created" },
    updatedAt: { type: "string", format: "date-time", description: "When event was last updated" }
  }
};

// Schema for multiple events response
export const eventsResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    data: {
      type: "array",
      items: eventResponseSchema,
      description: "List of events"
    },
    pagination: {
      type: "object",
      properties: {
        hasMore: {
          type: "boolean",
          description: "Whether more events are available"
        },
        lastEvaluatedKey: {
          type: "object",
          nullable: true,
          description: "Key for fetching next batch"
        },
        count: {
          type: "number",
          description: "Number of events in current batch"
        }
      },
      nullable: true
    }
  }
};

// Schema for event creation response
export const eventCreationResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    data: eventResponseSchema,
    message: {
      type: "string",
      nullable: true,
      description: "Success message"
    }
  }
};

// Schema for event types and categories response
export const eventTypesResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    data: {
      type: "object",
      properties: {
        eventTypes: {
          type: "array",
          items: {
            type: "string",
            enum: Object.values(EventType)
          },
          description: "Available event types"
        },
        categories: {
          type: "array",
          items: {
            type: "string",
            enum: Object.values(EventCategory)
          },
          description: "Available event categories"
        }
      }
    }
  }
};

// Schema for event statistics response
export const eventStatsResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    data: {
      type: "object",
      properties: {
        totalEvents: { type: "number" },
        eventsByType: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "Count of events by type"
        },
        eventsByCategory: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "Count of events by category"
        },
        recentEvents: {
          type: "number",
          description: "Events in last 24 hours"
        },
        topUsers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              userId: { type: "number" },
              eventCount: { type: "number" }
            }
          },
          description: "Users with most events"
        }
      }
    }
  }
};

// WebSocket message schemas
export const webSocketMessageSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["event", "system", "prefetch", "ui_update", "progress"],
      description: "Type of WebSocket message"
    },
    eventType: {
      type: "string",
      enum: Object.values(EventType),
      nullable: true,
      description: "Original event type if applicable"
    },
    priority: {
      type: "string",
      enum: ["critical", "high", "medium", "low"],
      description: "Message priority for client handling"
    },
    data: {
      type: "object",
      description: "Message-specific data",
      additionalProperties: true
    },
    timestamp: {
      type: "number",
      description: "Message timestamp"
    },
    userId: {
      type: "number",
      description: "Target user ID"
    }
  },
  required: ["type", "priority", "data", "timestamp", "userId"],
  additionalProperties: false
};

// Success response schema
export const successResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    message: {
      type: "string",
      nullable: true,
      description: "Success message"
    }
  }
};

// Error response schema
export const errorResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    error: {
      type: "string",
      description: "Error message"
    },
    code: {
      type: "string",
      nullable: true,
      description: "Error code"
    },
    details: {
      type: "object",
      nullable: true,
      description: "Additional error details",
      additionalProperties: true
    }
  }
};

// Export all schemas
export default {
  // Creation schemas
  createEventSchema,
  createTestEventSchema,

  // Query schemas
  eventQuerySchema,

  // Response schemas
  eventResponseSchema,
  eventsResponseSchema,
  eventCreationResponseSchema,
  eventTypesResponseSchema,
  eventStatsResponseSchema,
  webSocketMessageSchema,

  // Payload schemas for specific event types
  propertyViewedPayloadSchema,
  incidentStatusChangedPayloadSchema,
  inspectionBulkPhotosPayloadSchema,

  // Common schemas
  eventMetadataSchema,
  successResponseSchema,
  errorResponseSchema
};
