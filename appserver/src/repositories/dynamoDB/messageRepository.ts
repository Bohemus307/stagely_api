// src/repositories/dynamoDB/messageRepository.ts
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from 'uuid';
import { TableNames } from "../../config/dynamoTables";


export interface DynamoDBMessage {
  messageId: string;
  conversationId: string;
  senderId: number;
  text: string;
  timestamp: number;
  status: Record<string, string>; // userId -> status
}

export class DynamoDBMessageRepository {
  private readonly tableName: string;
  private readonly documentClient: any;

  constructor(documentClient: any, deploymentEnv: string = process.env.NODE_ENV || 'development') {
    this.documentClient = documentClient;
    // Append environment to table name
    this.tableName = `${TableNames.MESSAGES}-${deploymentEnv}`;
  }

  /**
   * Send a new message in a conversation
   */
  async createMessage(
    conversationId: string,
    senderId: number,
    text: string,
    participants: number[],
  ): Promise<DynamoDBMessage> {
    const messageId = `msg_${uuidv4()}`;
    const now = Date.now();

    // Initialize message status for all participants
    const status: Record<string, string> = {};
    participants.forEach(participantId => {
      status[participantId.toString()] = participantId === senderId ? 'READ' : 'SENT';
    });

    const message: DynamoDBMessage = {
      messageId,
      conversationId,
      senderId,
      text,
      timestamp: now,
      status,
    };

    const params = {
      TableName: this.tableName,
      Item: message
    };

    await this.documentClient.send(new PutCommand(params));
    return message;
  }

  /**
   * Get a message by ID
   */
  async getMessageById(messageId: string, conversationId: string): Promise<DynamoDBMessage | null> {
    const params = {
      TableName: this.tableName,
      Key: {
        messageId,
        conversationId
      }
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return result.Item as DynamoDBMessage || null;
  }

  /**
   * Get messages for a conversation with pagination
   */
  async getMessagesForConversation(
    conversationId: string,
    limit: number = 20,
    lastEvaluatedKey?: any
  ): Promise<{
    messages: DynamoDBMessage[];
    lastEvaluatedKey?: any;
  }> {
    const params = {
      TableName: this.tableName,
      IndexName: 'conversationId-timestamp-index',
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': conversationId
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      messages: (result.Items || []) as DynamoDBMessage[],
      lastEvaluatedKey: result.LastEvaluatedKey
    };
  }

  /**
   * Update message status for a user
   */
  async updateMessageStatus(
    messageId: string,
    conversationId: string,
    userId: number,
    status: 'SENT' | 'DELIVERED' | 'READ'
  ): Promise<DynamoDBMessage> {
    const userIdStr = userId.toString();

    const params = {
      TableName: this.tableName,
      Key: {
        messageId,
        conversationId
      },
      UpdateExpression: `set status.#userId = :status`,
      ExpressionAttributeNames: {
        '#userId': userIdStr
      },
      ExpressionAttributeValues: {
        ':status': status
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await this.documentClient.send(new UpdateCommand(params));
    return result.Attributes as DynamoDBMessage;
  }

  /**
   * Update message status for multiple messages
   */
  async batchUpdateMessageStatus(
    messageInfos: Array<{ messageId: string, conversationId: string }>,
    userId: number,
    status: 'SENT' | 'DELIVERED' | 'READ'
  ): Promise<void> {
    const userIdStr = userId.toString();

    // DynamoDB batch operations are limited to 25 items per request
    const batchSize = 25;

    for (let i = 0; i < messageInfos.length; i += batchSize) {
      const batch = messageInfos.slice(i, i + batchSize);

      const updates = await Promise.all(
        batch.map(async ({ messageId, conversationId }) => {
          const message = await this.getMessageById(messageId, conversationId);
          if (!message) return null;

          message.status[userIdStr] = status;

          return {
            PutRequest: {
              Item: message
            }
          };
        })
      );

      // Filter out nulls (messages that weren't found)
      const validUpdates = updates.filter(Boolean);

      if (validUpdates.length > 0) {
        const params = {
          RequestItems: {
            [this.tableName]: validUpdates
          }
        };

        await this.documentClient.send(new BatchWriteCommand(params));
      }
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string, conversationId: string): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: {
        messageId,
        conversationId
      }
    };

    await this.documentClient.send(new DeleteCommand(params));
  }
}
