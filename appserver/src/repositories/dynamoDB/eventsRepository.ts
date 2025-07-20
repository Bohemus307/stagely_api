import {
    PutCommand,
    GetCommand,
    QueryCommand,
    DeleteCommand,
    ScanCommand,
    BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TableNames } from "../../config/dynamoTables";
import { v4 as uuidv4 } from "uuid";

// Event Categories
export enum EventCategory {
    PROPERTY = 'property',
    INCIDENT = 'incident',
    INSPECTION = 'inspection'
}

// Event Types
export enum EventType {

    // Property Events
    PROPERTY_VIEWED = 'property_viewed',
    PROPERTY_UPDATED = 'property_updated',
    PROPERTY_STATUS_CHANGED = 'property_status_changed',
    PROPERTY_STATS_VIEWED = 'property_stats_viewed',

    // Incident Events
    INCIDENT_VIEWED = 'incident_viewed',
    INCIDENT_UPDATED = 'incident_updated',
    INCIDENT_STATUS_CHANGED = 'incident_status_changed',
    INCIDENT_SEVERITY_CHANGED = 'incident_severity_changed',
    INCIDENT_IMAGE_UPLOADED = 'incident_image_uploaded',

    //Inspection Events
    INSPECTION_COMPLETED = 'inspection_completed',
    INSPECTION_VIEWED = 'inspection_viewed',
    INSPECTION_UPDATED = 'inspection_updated',
    INSPECTION_PHOTO_UPLOADED = 'inspection_photo_uploaded',
    INSPECTION_BULK_PHOTOS_UPLOADED = 'inspection_bulk_photos_uploaded'
}

export interface EventMetadata {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  source?: string; // 'mobile', 'web', 'api', etc.
  version?: string;
  performanceMetrics?: {
        duration?: number;
        memoryUsage?: number;
        queryCount?: number;
        cacheHit?: boolean;
  };
}

export interface DynamoDBEvent {
  eventId: string;
  userId: number;
  eventType: EventType;
  category: EventCategory;
  timestamp: number;
  title: string;
  description: string;
  payload: any; // Full event details
  metadata?: EventMetadata;
  relatedEntityId?: string; // conversationId, messageId, etc.
  relatedEntityType?: string; // 'conversation', 'message',
  ttl?: number; // Optional TTL for event expiration
}

export class DynamoDBEventRepository {
  private readonly tableName: string;
  private readonly documentClient: any;

  constructor(documentClient: any, deploymentEnv: string = "staging") {
    this.documentClient = documentClient;
    this.tableName = `${TableNames.EVENTS}-${deploymentEnv}`;
  }

  /**
   * Create a new event
   */
  async createEvent(eventData: Omit<DynamoDBEvent, 'eventId' | 'timestamp'>): Promise<DynamoDBEvent> {
    const event: DynamoDBEvent = {
      eventId: uuidv4(),
      timestamp: Date.now(),
      ...eventData
    };

    const params = {
      TableName: this.tableName,
      Item: event,
    };

    await this.documentClient.send(new PutCommand(params));
    return event;
  }

  /**
     * Create multiple events in batch (for performance)
     */
    async createEventsBatch(eventsData: Omit<DynamoDBEvent, 'eventId' | 'timestamp'>[]): Promise<DynamoDBEvent[]> {
        const events: DynamoDBEvent[] = eventsData.map(eventData => ({
            eventId: uuidv4(),
            timestamp: Date.now(),
            ...eventData
        }));

        // DynamoDB batch write (up to 25 items per request)
        const batches = [];
        for (let i = 0; i < events.length; i += 25) {
            batches.push(events.slice(i, i + 25));
        }

        for (const batch of batches) {
            const params = {
                RequestItems: {
                    [this.tableName]: batch.map(event => ({
                        PutRequest: {
                            Item: event
                        }
                    }))
                }
            };

            await this.documentClient.send(new BatchWriteCommand(params));
        }

        return events;
    }

  /**
   * Get a specific event by ID
   */
  async getEvent(eventId: string, timestamp: number): Promise<DynamoDBEvent | null> {
    const params = {
      TableName: this.tableName,
      Key: { eventId, timestamp },
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return (result.Item as DynamoDBEvent) || null;
  }

  /**
     * Get events for a specific user
     */
    async getEventsForUser(
        userId: number,
        limit: number = 50,
        lastEvaluatedKey?: any,
        startTime?: number,
        endTime?: number
    ): Promise<{
        events: DynamoDBEvent[];
        lastEvaluatedKey?: any;
    }> {
        const params: any = {
            TableName: this.tableName,
            IndexName: 'userId-timestamp-index',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId,
            },
            Limit: limit,
            ScanIndexForward: false, // Most recent first
        };

        if (startTime && endTime) {
            params.KeyConditionExpression += ' AND #timestamp BETWEEN :startTime AND :endTime';
            params.ExpressionAttributeNames = { '#timestamp': 'timestamp' };
            params.ExpressionAttributeValues[':startTime'] = startTime;
            params.ExpressionAttributeValues[':endTime'] = endTime;
        }

        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const result = await this.documentClient.send(new QueryCommand(params));

        return {
            events: result.Items as DynamoDBEvent[],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

  /**
   * Get events by type
   */
  async getEventsByType(
    eventType: EventType,
    limit: number = 50,
    lastEvaluatedKey?: any,
    startTime?: number,
    endTime?: number
  ): Promise<{
    events: DynamoDBEvent[];
    lastEvaluatedKey?: any;
  }> {
    const params: any = {
            TableName: this.tableName,
            IndexName: 'eventType-timestamp-index',
            KeyConditionExpression: 'eventType = :eventType',
            ExpressionAttributeValues: {
                ':eventType': eventType,
            },
            Limit: limit,
            ScanIndexForward: false,
        };

        if (startTime && endTime) {
            params.KeyConditionExpression += ' AND #timestamp BETWEEN :startTime AND :endTime';
            params.ExpressionAttributeNames = { '#timestamp': 'timestamp' };
            params.ExpressionAttributeValues[':startTime'] = startTime;
            params.ExpressionAttributeValues[':endTime'] = endTime;
        }

        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const result = await this.documentClient.send(new QueryCommand(params));

        return {
            events: result.Items as DynamoDBEvent[],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }


  /**
   * Get events by category
   */
  async getEventsByCategory(
    category: EventCategory,
    limit: number = 50,
    lastEvaluatedKey?: any,
    startTime?: number,
    endTime?: number
  ): Promise<{
    events: DynamoDBEvent[];
    lastEvaluatedKey?: any;
  }> {
    const params: any = {
            TableName: this.tableName,
            IndexName: 'category-timestamp-index',
            KeyConditionExpression: 'category = :category',
            ExpressionAttributeValues: {
                ':category': category,
            },
            Limit: limit,
            ScanIndexForward: false,
        };

        if (startTime && endTime) {
            params.KeyConditionExpression += ' AND #timestamp BETWEEN :startTime AND :endTime';
            params.ExpressionAttributeNames = { '#timestamp': 'timestamp' };
            params.ExpressionAttributeValues[':startTime'] = startTime;
            params.ExpressionAttributeValues[':endTime'] = endTime;
        }

        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const result = await this.documentClient.send(new QueryCommand(params));

        return {
            events: result.Items as DynamoDBEvent[],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

  /**
   * Get events with filtering
   */
  async getEventsWithFilters(
        userId?: number,
        eventTypes?: EventType[],
        categories?: EventCategory[],
        startTime?: number,
        endTime?: number,
        limit: number = 50,
        lastEvaluatedKey?: any
    ): Promise<{
        events: DynamoDBEvent[];
        lastEvaluatedKey?: any;
    }> {
        // If userId is provided, use the user index for better performance
        if (userId) {
            return this.getEventsForUser(userId, limit, lastEvaluatedKey, startTime, endTime);
        }

        // Otherwise, use scan with filters (less efficient but more flexible)
        const params: any = {
            TableName: this.tableName,
            Limit: limit,
        };

        const filterExpressions = [];
        const expressionAttributeValues: any = {};
        const expressionAttributeNames: any = {};

        if (eventTypes && eventTypes.length > 0) {
            const eventTypeConditions = eventTypes.map((type, index) => {
                const placeholder = `:eventType${index}`;
                expressionAttributeValues[placeholder] = type;
                return `eventType = ${placeholder}`;
            });
            filterExpressions.push(`(${eventTypeConditions.join(' OR ')})`);
        }

        if (categories && categories.length > 0) {
            const categoryConditions = categories.map((category, index) => {
                const placeholder = `:category${index}`;
                expressionAttributeValues[placeholder] = category;
                return `category = ${placeholder}`;
            });
            filterExpressions.push(`(${categoryConditions.join(' OR ')})`);
        }

        if (startTime && endTime) {
            filterExpressions.push('#timestamp BETWEEN :startTime AND :endTime');
            expressionAttributeNames['#timestamp'] = 'timestamp';
            expressionAttributeValues[':startTime'] = startTime;
            expressionAttributeValues[':endTime'] = endTime;
        }

        if (filterExpressions.length > 0) {
            params.FilterExpression = filterExpressions.join(' AND ');
        }

        if (Object.keys(expressionAttributeValues).length > 0) {
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        if (Object.keys(expressionAttributeNames).length > 0) {
            params.ExpressionAttributeNames = expressionAttributeNames;
        }

        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const result = await this.documentClient.send(new ScanCommand(params));

        return {
            events: result.Items as DynamoDBEvent[],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }

  /**
   * Delete an event (optional - for cleanup)
   */
  async deleteEvent(eventId: string, timestamp: number): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: { eventId, timestamp },
    };

    await this.documentClient.send(new DeleteCommand(params));
  }
}
