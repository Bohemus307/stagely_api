// src/repositories/dynamoDB/connectionRepository.ts
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { TableNames } from "../../config/dynamoTables";

export interface DynamoDBConnection {
  connectionId: string;
  userId: number;
  deviceId?: string;
  timestamp: number;
  ttl: number; // Time to live in seconds since epoch
}

export class DynamoDBConnectionRepository {
  private readonly tableName: string;
  private readonly documentClient: any;

  constructor(documentClient: any, deploymentEnv: string = "staging") {
    this.documentClient = documentClient;
    // Append environment to table name
    this.tableName = `${TableNames.CONNECTIONS}-${deploymentEnv}`;
  }

  /**
   * Store a new user connection
   */
  async saveConnection(
    connectionId: string,
    userId: number,
    deviceId?: string,
  ): Promise<DynamoDBConnection> {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const ttl = now + 24 * 60 * 60; // 24 hours from now

    const connection: DynamoDBConnection = {
      connectionId,
      userId,
      deviceId,
      timestamp: now * 1000, // Store in ms for consistency
      ttl,
    };

    const params = {
      TableName: this.tableName,
      Item: connection,
    };

    await this.documentClient.send(new PutCommand(params));
    return connection;
  }

  /**
   * Get a connection by ID
   */
  async getConnection(
    connectionId: string,
  ): Promise<DynamoDBConnection | null> {
    const params = {
      TableName: this.tableName,
      Key: { connectionId },
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return (result.Item as DynamoDBConnection) || null;
  }

  /**
   * Get all connections for a user
   */
  async getConnectionsForUser(userId: number): Promise<DynamoDBConnection[]> {
    const params = {
      TableName: this.tableName,
      IndexName: "userId-index",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
    };

    const result = await this.documentClient.send(new QueryCommand(params));
    return (result.Items || []) as DynamoDBConnection[];
  }

  /**
   * Delete a connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: { connectionId },
    };

    await this.documentClient.send(new DeleteCommand(params));
  }

  /**
   * Get all active connections
   * This can be used to broadcast messages to all users
   * Note: This will scan the entire table which can be expensive for large tables
   */
  async getAllConnections(
    limit: number = 100,
    lastEvaluatedKey?: any,
  ): Promise<{
    connections: DynamoDBConnection[];
    lastEvaluatedKey?: any;
  }> {
    const now = Math.floor(Date.now() / 1000);

    const params = {
      TableName: this.tableName,
      FilterExpression: "ttl > :now",
      ExpressionAttributeValues: {
        ":now": now,
      },
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new ScanCommand(params));

    return {
      connections: (result.Items || []) as DynamoDBConnection[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }
}
