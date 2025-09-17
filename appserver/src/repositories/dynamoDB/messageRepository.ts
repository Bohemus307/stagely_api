// src/repositories/dynamoDB/messageRepository.ts
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { TableNames } from "../../config/dynamoTables";
import { ReturnValue } from "@aws-sdk/client-dynamodb";

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

  constructor(documentClient: any, deploymentEnv: string = "staging") {
    this.documentClient = documentClient;
    // Append environment to table name
    this.tableName = `${TableNames.MESSAGES}-${deploymentEnv}`;
  }

  /**
   * Validate participant ID
   */
  private validateParticipant(participantId: number): void {
    if (!Number.isInteger(participantId) || participantId < 1) {
      throw new Error(`Invalid participant ID: ${participantId}`);
    }
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
    participants.forEach((participantId) => {
      status[participantId.toString()] =
        participantId === senderId ? "READ" : "SENT";
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
      Item: message,
    };

    await this.documentClient.send(new PutCommand(params));
    return message;
  }

  /**
   * Get a message by ID
   */
  async getMessageById(
    messageId: string,
    conversationId: string,
  ): Promise<DynamoDBMessage | null> {
    const params = {
      TableName: this.tableName,
      Key: {
        messageId,
        conversationId,
      },
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return (result.Item as DynamoDBMessage) || null;
  }

  /**
   * Get messages for a conversation with pagination
   */
  async getMessagesForConversation(
    conversationId: string,
    limit: number = 20,
    lastEvaluatedKey?: any,
  ): Promise<{
    messages: DynamoDBMessage[];
    lastEvaluatedKey?: any;
  }> {
    const params = {
      TableName: this.tableName,
      IndexName: "conversationId-timestamp-index",
      KeyConditionExpression: "conversationId = :conversationId",
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      messages: (result.Items || []) as DynamoDBMessage[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Update message status for a user
   */
  async updateMessageStatus(
    messageId: string,
    conversationId: string,
    userId: number,
    status: "SENT" | "DELIVERED" | "READ",
  ): Promise<DynamoDBMessage> {
    const userIdStr = userId.toString();

    const params = {
      TableName: this.tableName,
      Key: {
        messageId,
        conversationId,
      },
      UpdateExpression: `set #status.#userId = :status`,
      ExpressionAttributeNames: {
        "#status": "status",
        "#userId": userIdStr,
      },
      ExpressionAttributeValues: {
        ":status": status,
      },
      ReturnValues: ReturnValue.ALL_NEW,
    };

    const result = await this.documentClient.send(new UpdateCommand(params));
    return result.Attributes as DynamoDBMessage;
  }

  /**
   * Update message status for multiple messages
   */
  async batchUpdateMessageStatus(
    messageInfos: Array<{ messageId: string; conversationId: string }>,
    userId: number,
    status: "SENT" | "DELIVERED" | "READ",
  ): Promise<void> {
    const userIdStr = userId.toString();
    const batchSize = 25;

    for (let i = 0; i < messageInfos.length; i += batchSize) {
      const batch = messageInfos.slice(i, i + batchSize);

      // Use BatchGetItem to get all messages at once
      const batchGetParams = {
        RequestItems: {
          [this.tableName]: {
            Keys: batch.map((info) => ({
              messageId: info.messageId,
              conversationId: info.conversationId,
            })),
          },
        },
      };

      const batchGetResult = await this.documentClient.send(
        new BatchGetCommand(batchGetParams),
      );
      const messages = batchGetResult.Responses?.[this.tableName] || [];

      // Update status and prepare BatchWriteItem
      const updates = messages.map(
        (message: { status: { [x: string]: string } }) => {
          message.status[userIdStr] = status;
          return {
            PutRequest: {
              Item: message,
            },
          };
        },
      );

      if (updates.length > 0) {
        const params = {
          RequestItems: {
            [this.tableName]: updates,
          },
        };

        try {
          const result = await this.documentClient.send(
            new BatchWriteCommand(params),
          );

          // Handle unprocessed items
          if (
            result.UnprocessedItems &&
            Object.keys(result.UnprocessedItems).length > 0
          ) {
            // Implement retry logic here if needed
            console.warn(
              "Unprocessed items in batch write:",
              result.UnprocessedItems,
            );
          }
        } catch (error) {
          console.error("Error in batch update:", error);
          throw error;
        }
      }
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(
    messageId: string,
    conversationId: string,
  ): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: {
        messageId,
        conversationId,
      },
    };

    await this.documentClient.send(new DeleteCommand(params));
  }
}
