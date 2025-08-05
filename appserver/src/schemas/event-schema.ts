
const eventSchemas = {
  // Common event object schema
  eventObjectSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string' },
      userId: { type: 'number' },
      eventType: { type: 'string' },
      category: { type: 'string' },
      timestamp: { type: 'number' },
      title: { type: 'string' },
      description: { type: 'string' },
      payload: { type: 'object' },
      metadata: { type: 'object' },
      relatedEntityId: { type: 'string' },
      relatedEntityType: { type: 'string' }
    }
  },

  // Event response schema (single event)
  eventResponseSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          userId: { type: 'number' },
          eventType: { type: 'string' },
          category: { type: 'string' },
          timestamp: { type: 'number' },
          title: { type: 'string' },
          description: { type: 'string' },
          payload: { type: 'object' },
          metadata: { type: 'object' },
          relatedEntityId: { type: 'string' },
          relatedEntityType: { type: 'string' }
        }
      }
    }
  },

  // Events list response schema (multiple events with pagination)
  eventsResponseSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            eventId: { type: 'string' },
            userId: { type: 'number' },
            eventType: { type: 'string' },
            category: { type: 'string' },
            timestamp: { type: 'number' },
            title: { type: 'string' },
            description: { type: 'string' },
            payload: { type: 'object' },
            metadata: { type: 'object' },
            relatedEntityId: { type: 'string' },
            relatedEntityType: { type: 'string' }
          }
        }
      },
      pagination: {
        type: 'object',
        properties: {
          hasMore: { type: 'boolean' },
          lastEvaluatedKey: { type: 'object' }
        }
      }
    }
  },

  // Query schema for filtering events
  eventQuerySchema: {
    type: 'object',
    properties: {
      userId: { type: 'number' },
      eventTypes: {
        type: 'array',
        items: { type: 'string' }
      },
      categories: {
        type: 'array',
        items: { type: 'string' }
      },
      startTime: { type: 'number' },
      endTime: { type: 'number' },
      limit: { type: 'number', default: 50, minimum: 1, maximum: 100 },
      lastEvaluatedKey: { type: 'string' }
    },
    required: ['userId'],
    additionalProperties: false
  },

  // Query schema for user-specific events
  userEventsQuerySchema: {
    type: 'object',
    properties: {
      requestingUserId: { type: 'number' },
      startTime: { type: 'number' },
      endTime: { type: 'number' },
      limit: { type: 'number', default: 50, minimum: 1, maximum: 100 },
      lastEvaluatedKey: { type: 'string' }
    },
    required: ['requestingUserId'],
    additionalProperties: false
  },

  // Query schema for events by type/category
  typeOrCategoryQuerySchema: {
    type: 'object',
    properties: {
      userId: { type: 'number' },
      startTime: { type: 'number' },
      endTime: { type: 'number' },
      limit: { type: 'number', default: 50, minimum: 1, maximum: 100 },
      lastEvaluatedKey: { type: 'string' }
    },
    required: ['userId'],
    additionalProperties: false
  },

  // Recent events query schema
  recentEventsQuerySchema: {
    type: 'object',
    properties: {
      userId: { type: 'number' },
      limit: { type: 'number', default: 20, minimum: 1, maximum: 50 }
    },
    required: ['userId'],
    additionalProperties: false
  },

  // Create event request body
  createEventBodySchema: {
    type: 'object',
    properties: {
      userId: { type: 'number' },
      eventType: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      payload: { type: 'object' },
      metadata: { type: 'object' },
      relatedEntityId: { type: 'string' },
      relatedEntityType: { type: 'string' }
    },
    required: ['userId', 'eventType', 'title', 'description', 'payload'],
    additionalProperties: false
  },

  // Test event creation body
  testEventBodySchema: {
    type: 'object',
    properties: {
      userId: { type: 'number' },
      eventType: { type: 'string' },
      title: { type: 'string', default: 'Test Event' },
      description: { type: 'string', default: 'Testing event creation' },
      payload: { type: 'object', default: { test: true } }
    },
    required: ['userId'],
    additionalProperties: false
  },

  // Event types response schema
  eventTypesResponseSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: {
        type: 'object',
        properties: {
          eventTypes: {
            type: 'array',
            items: { type: 'string' }
          },
          categories: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  },

  // Success response schema
  successResponseSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true }
    }
  },

  // Error response schema
  errorResponseSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: { type: 'string' }
    }
  },

  // Test event success response
  testEventResponseSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: { type: 'object' },
      message: { type: 'string' }
    }
  }
};

export default eventSchemas;
