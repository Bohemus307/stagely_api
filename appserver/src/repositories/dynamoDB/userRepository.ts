// src/repositories/dynamoDB/userRepository.ts
import {
    PutCommand,
    GetCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand,
    ScanCommand
  } from "@aws-sdk/lib-dynamodb";
  import { TableNames } from "../../config/dynamoTables";

  export interface DynamoDBUser {
    userId: string;  // Match with Auth0 ID
    email: string;
    firstName: string;
    lastName: string;
    profilePictureUrl?: string;
    lastSeen: number;
    createdAt: number;
    updatedAt: number;
  }

  export class DynamoDBUserRepository {
    private readonly tableName: string;
    private readonly documentClient: any;

    constructor(documentClient: any, deploymentEnv: string = process.env.NODE_ENV || 'development') {
      this.documentClient = documentClient;
      // Append environment to table name
      this.tableName = `${TableNames.USERS}-${deploymentEnv}`;
    }

    /**
     * Create a new user in DynamoDB
     */
    async createUser(user: DynamoDBUser): Promise<DynamoDBUser> {
      const now = Date.now();
      const item = {
        ...user,
        createdAt: user.createdAt || now,
        updatedAt: user.updatedAt || now,
        lastSeen: user.lastSeen || now
      };

      const params = {
        TableName: this.tableName,
        Item: item
      };

      await this.documentClient.send(new PutCommand(params));
      return item;
    }

    /**
     * Get a user by their userId (Auth0 ID)
     */
    async getUserById(userId: string): Promise<DynamoDBUser | null> {
      const params = {
        TableName: this.tableName,
        Key: { userId }
      };

      const result = await this.documentClient.send(new GetCommand(params));
      return result.Item as DynamoDBUser || null;
    }

    /**
     * Update a user's last seen timestamp
     */
    async updateUserLastSeen(userId: string): Promise<void> {
      const params = {
        TableName: this.tableName,
        Key: { userId },
        UpdateExpression: 'set lastSeen = :lastSeen',
        ExpressionAttributeValues: {
          ':lastSeen': Date.now()
        }
      };

      await this.documentClient.send(new UpdateCommand(params));
    }

    /**
     * Update a user's profile information
     */
    async updateUser(userId: string, updates: Partial<DynamoDBUser>): Promise<DynamoDBUser> {
      // First, get the current user
      const currentUser = await this.getUserById(userId);
      if (!currentUser) {
        throw new Error(`User not found with ID: ${userId}`);
      }

      // Build the update expression and attribute values
      let updateExpression = 'set updatedAt = :updatedAt';
      const expressionAttributeValues: Record<string, any> = {
        ':updatedAt': Date.now()
      };

      // Add each field to the update expression
      Object.entries(updates).forEach(([key, value]) => {
        if (key !== 'userId' && key !== 'createdAt') {
          updateExpression += `, ${key} = :${key}`;
          expressionAttributeValues[`:${key}`] = value;
        }
      });

      const params = {
        TableName: this.tableName,
        Key: { userId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW'
      };

      const result = await this.documentClient.send(new UpdateCommand(params));
      return result.Attributes as DynamoDBUser;
    }

    /**
     * Delete a user
     */
    async deleteUser(userId: string): Promise<void> {
      const params = {
        TableName: this.tableName,
        Key: { userId }
      };

      await this.documentClient.send(new DeleteCommand(params));
    }
  }
