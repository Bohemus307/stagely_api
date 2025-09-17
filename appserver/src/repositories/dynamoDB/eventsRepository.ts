// src/repositories/dynamoDB/eventRepository.ts
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { TableNames } from "../../config/dynamoTables";

export interface DynamoDBEvent {
  eventId: string;
  eventType: string;
  timestamp: number;
  userId?: number;
  entityId?: string;
  entityType?: string;
  datePartition: string;
  metadata?: Record<string, any>;
  source?: string;
  version?: string;
  ttl?: number;
}

export interface DynamoDBEventAggregation {
  aggregationKey: string;
  timePeriod: string;
  aggregationType: string;
  count: number;
  uniqueUsers?: number[];
  metadata?: Record<string, any>;
  ttl?: number;
}

export class DynamoDBEventRepository {
  private readonly eventsTableName: string;
  private readonly aggregationsTableName: string;
  private readonly documentClient: any;

  constructor(documentClient: any, deploymentEnv: string = "staging") {
    this.documentClient = documentClient;
    // Append environment to table names
    this.eventsTableName = `${TableNames.EVENTS}-${deploymentEnv}`;
    this.aggregationsTableName = `${TableNames.EVENT_AGGREGATIONS}-${deploymentEnv}`;
  }

  /**
   * Helper function to generate event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Helper function to generate date partition
   */
  private getDatePartition(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Save a new event
   */
  async saveEvent(
    eventType: string,
    userId?: number,
    entityId?: string,
    entityType?: string,
    metadata?: Record<string, any>,
    source?: string,
    ttlDays: number = 90,
  ): Promise<DynamoDBEvent> {
    const timestamp = Date.now();
    const ttl = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;

    const event: DynamoDBEvent = {
      eventId: this.generateEventId(),
      eventType,
      timestamp,
      userId,
      entityId,
      entityType,
      datePartition: this.getDatePartition(timestamp),
      metadata,
      source: source || "app-server",
      version: "1.0",
      ttl,
    };

    const params = {
      TableName: this.eventsTableName,
      Item: event,
    };

    await this.documentClient.send(new PutCommand(params));
    return event;
  }

  /**
   * Batch save multiple events
   */
  async saveEventsBatch(
    events: Omit<DynamoDBEvent, "eventId" | "datePartition">[],
  ): Promise<void> {
    const timestamp = Date.now();
    const items = events.map((event) => ({
      PutRequest: {
        Item: {
          ...event,
          eventId: this.generateEventId(),
          datePartition: this.getDatePartition(event.timestamp || timestamp),
          timestamp: event.timestamp || timestamp,
        },
      },
    }));

    // DynamoDB batch write has a limit of 25 items
    const chunks = [];
    for (let i = 0; i < items.length; i += 25) {
      chunks.push(items.slice(i, i + 25));
    }

    for (const chunk of chunks) {
      const params = {
        RequestItems: {
          [this.eventsTableName]: chunk,
        },
      };
      await this.documentClient.send(new BatchWriteCommand(params));
    }
  }

  /**
   * Get an event by ID
   */
  async getEvent(eventId: string): Promise<DynamoDBEvent | null> {
    const params = {
      TableName: this.eventsTableName,
      Key: { eventId },
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return (result.Item as DynamoDBEvent) || null;
  }

  /**
   * Get events for a specific user
   */
  async getUserEvents(
    userId: number,
    startTime?: number,
    endTime?: number,
    limit: number = 100,
    lastEvaluatedKey?: any,
  ): Promise<{
    events: DynamoDBEvent[];
    lastEvaluatedKey?: any;
  }> {
    let keyConditionExpression = "userId = :userId";
    const expressionAttributeValues: any = {
      ":userId": userId,
    };

    if (startTime && endTime) {
      keyConditionExpression += " AND #ts BETWEEN :start AND :end";
      expressionAttributeValues[":start"] = startTime;
      expressionAttributeValues[":end"] = endTime;
    }

    const params = {
      TableName: this.eventsTableName,
      IndexName: "userId-timestamp-index",
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(startTime &&
        endTime && { ExpressionAttributeNames: { "#ts": "timestamp" } }),
      ScanIndexForward: false, // Most recent first
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      events: (result.Items || []) as DynamoDBEvent[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Get events by type within a time range
   */
  async getEventsByType(
    eventType: string,
    startTime: number,
    endTime: number,
    limit: number = 100,
    lastEvaluatedKey?: any,
  ): Promise<{
    events: DynamoDBEvent[];
    lastEvaluatedKey?: any;
  }> {
    const params = {
      TableName: this.eventsTableName,
      IndexName: "eventType-timestamp-index",
      KeyConditionExpression:
        "eventType = :eventType AND #ts BETWEEN :start AND :end",
      ExpressionAttributeNames: {
        "#ts": "timestamp",
      },
      ExpressionAttributeValues: {
        ":eventType": eventType,
        ":start": startTime,
        ":end": endTime,
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      events: (result.Items || []) as DynamoDBEvent[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Get all events for a specific entity
   */
  async getEntityEvents(
    entityId: string,
    startTime?: number,
    endTime?: number,
    limit: number = 100,
    lastEvaluatedKey?: any,
  ): Promise<{
    events: DynamoDBEvent[];
    lastEvaluatedKey?: any;
  }> {
    let keyConditionExpression = "entityId = :entityId";
    const expressionAttributeValues: any = {
      ":entityId": entityId,
    };

    if (startTime && endTime) {
      keyConditionExpression += " AND #ts BETWEEN :start AND :end";
      expressionAttributeValues[":start"] = startTime;
      expressionAttributeValues[":end"] = endTime;
    }

    const params = {
      TableName: this.eventsTableName,
      IndexName: "entityId-timestamp-index",
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(startTime &&
        endTime && { ExpressionAttributeNames: { "#ts": "timestamp" } }),
      ScanIndexForward: false, // Most recent first
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      events: (result.Items || []) as DynamoDBEvent[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Get events for a specific date
   */
  async getEventsByDate(
    date: string, // Format: "YYYY-MM-DD"
    startTime?: number,
    endTime?: number,
    limit: number = 100,
    lastEvaluatedKey?: any,
  ): Promise<{
    events: DynamoDBEvent[];
    lastEvaluatedKey?: any;
  }> {
    let keyConditionExpression = "datePartition = :date";
    const expressionAttributeValues: any = {
      ":date": date,
    };

    if (startTime && endTime) {
      keyConditionExpression += " AND #ts BETWEEN :start AND :end";
      expressionAttributeValues[":start"] = startTime;
      expressionAttributeValues[":end"] = endTime;
    }

    const params = {
      TableName: this.eventsTableName,
      IndexName: "datePartition-timestamp-index",
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(startTime &&
        endTime && { ExpressionAttributeNames: { "#ts": "timestamp" } }),
      ScanIndexForward: true, // Chronological order for date queries
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      events: (result.Items || []) as DynamoDBEvent[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Save or update an aggregation
   */
  async saveAggregation(
    aggregationKey: string,
    timePeriod: string,
    aggregationType: string,
    count: number,
    uniqueUsers?: number[],
    metadata?: Record<string, any>,
    ttlDays: number = 365,
  ): Promise<DynamoDBEventAggregation> {
    const ttl = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;

    const aggregation: DynamoDBEventAggregation = {
      aggregationKey,
      timePeriod,
      aggregationType,
      count,
      uniqueUsers,
      metadata,
      ttl,
    };

    const params = {
      TableName: this.aggregationsTableName,
      Item: aggregation,
    };

    await this.documentClient.send(new PutCommand(params));
    return aggregation;
  }

  /**
   * Increment an aggregation counter
   */
  async incrementAggregation(
    aggregationKey: string,
    timePeriod: string,
    incrementBy: number = 1,
    userId?: number,
  ): Promise<void> {
    const params: any = {
      TableName: this.aggregationsTableName,
      Key: {
        aggregationKey,
        timePeriod,
      },
      UpdateExpression: "ADD #count :inc",
      ExpressionAttributeNames: {
        "#count": "count",
      },
      ExpressionAttributeValues: {
        ":inc": incrementBy,
      },
    };

    // If userId provided, add to unique users set
    if (userId !== undefined) {
      params.UpdateExpression += ", uniqueUsers :userId";
      params.ExpressionAttributeValues[":userId"] = new Set([userId]);
    }

    await this.documentClient.send(new UpdateCommand(params));
  }

  /**
   * Get aggregations by type
   */
  async getAggregationsByType(
    aggregationType: string,
    startPeriod: string,
    endPeriod: string,
    limit: number = 100,
    lastEvaluatedKey?: any,
  ): Promise<{
    aggregations: DynamoDBEventAggregation[];
    lastEvaluatedKey?: any;
  }> {
    const params = {
      TableName: this.aggregationsTableName,
      IndexName: "aggregationType-timePeriod-index",
      KeyConditionExpression:
        "aggregationType = :type AND timePeriod BETWEEN :start AND :end",
      ExpressionAttributeValues: {
        ":type": aggregationType,
        ":start": startPeriod,
        ":end": endPeriod,
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      aggregations: (result.Items || []) as DynamoDBEventAggregation[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Get a specific aggregation
   */
  async getAggregation(
    aggregationKey: string,
    timePeriod: string,
  ): Promise<DynamoDBEventAggregation | null> {
    const params = {
      TableName: this.aggregationsTableName,
      Key: {
        aggregationKey,
        timePeriod,
      },
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return (result.Item as DynamoDBEventAggregation) || null;
  }
}
