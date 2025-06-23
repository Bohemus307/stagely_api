import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  TransactWriteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { TableNames } from "../../config/dynamoTables";
import { ReturnValue } from "@aws-sdk/client-dynamodb";

export interface DynamoDBConversation {
  conversationId: string;
  participants: number[];
  conversationType: "general";
  createdAt: number;
  lastMessageText?: string;
  lastMessageTime?: number;
  lastMessageSenderId?: number;
  unreadCount: Record<string, number>;
  version: number;
  participantId?: number;
}

export class DynamoDBConversationRepository {
  private readonly tableName: string;
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(documentClient: any, deploymentEnv: string = "staging") {
    this.documentClient = documentClient;
    this.tableName = `${TableNames.CONVERSATIONS}-${deploymentEnv}`;
  }

  private validateParticipant(participantId: number): void {
    if (!Number.isInteger(participantId) || participantId < 1) {
      throw new Error(`Invalid participant ID: ${participantId}`);
    }
  }

  /**
   * Create a new conversation with participant records for efficient querying
   */
  async createConversation(
    data: Omit<
      DynamoDBConversation,
      "conversationId" | "createdAt" | "unreadCount" | "version" | "participantId"
    >,
  ): Promise<DynamoDBConversation> {
    const conversationId = `conv_${uuidv4()}`;
    const now = Date.now();

    data.participants.forEach(participantId => {
      this.validateParticipant(participantId);
    });

    const unreadCount: Record<string, number> = {};
    data.participants.forEach((participantId) => {
      unreadCount[participantId.toString()] = 0;
    });

    const baseConversation: DynamoDBConversation = {
      conversationId,
      participants: data.participants,
      conversationType: data.conversationType || "general",
      lastMessageText: data.lastMessageText,
      lastMessageTime: data.lastMessageTime || now,
      lastMessageSenderId: data.lastMessageSenderId,
      createdAt: now,
      unreadCount,
      version: 1,
    };

    try {
      const mainRecord = { ...baseConversation };

      const participantRecords = data.participants.map(participantId => ({
        ...baseConversation,
        conversationId: `${conversationId}#${participantId}`,
        participantId,
      }));

      const allItems = [
        { PutRequest: { Item: mainRecord } },
        ...participantRecords.map(record => ({ PutRequest: { Item: record } }))
      ];

      for (let i = 0; i < allItems.length; i += 25) {
        const batch = allItems.slice(i, i + 25);
        await this.documentClient.send(new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: batch,
          },
        }));
      }

      console.log(`Created conversation ${conversationId} with ${data.participants.length} participants`);
      return mainRecord;

    } catch (error) {
      console.error("Error creating conversation:", error);
      throw error;
    }
  }

  /**
   * Get a conversation by ID (main record only)
   */
  async getConversationById(
    conversationId: string,
  ): Promise<DynamoDBConversation | null> {
    const params = {
      TableName: this.tableName,
      Key: { conversationId },
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return (result.Item as DynamoDBConversation) || null;
  }

  /**
   * Get conversations for a user using GSI
   */
  async getConversationsForUser(
    userId: number,
    limit: number = 20,
    lastEvaluatedKey?: any,
  ): Promise<{
    conversations: DynamoDBConversation[];
    lastEvaluatedKey?: Record<string, any>;
  }> {
    this.validateParticipant(userId);

    const params = {
      TableName: this.tableName,
      IndexName: 'participant-index',
      KeyConditionExpression: 'participantId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false,
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    try {
      const result = await this.documentClient.send(new QueryCommand(params));

      const conversations = (result.Items || []).map(item => {
        const mainConversationId = item.conversationId.split('#')[0];

        const { participantId, ...conversation } = item;
        return {
          ...conversation,
          conversationId: mainConversationId,
        };
      }) as DynamoDBConversation[];

      console.log(`Found ${conversations.length} conversations for user ${userId}`);

      return {
        conversations,
        lastEvaluatedKey: result.LastEvaluatedKey,
      };

    } catch (error) {
      console.error(`Error fetching conversations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update conversation with new message info
   */
  async updateWithNewMessage(
    conversationId: string,
    senderId: number,
    messageText: string,
  ): Promise<DynamoDBConversation> {
    this.validateParticipant(senderId);

    const now = Date.now();

    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const updatedUnreadCount = { ...conversation.unreadCount };
    conversation.participants.forEach((participantId) => {
      if (participantId !== senderId) {
        const key = participantId.toString();
        updatedUnreadCount[key] = (updatedUnreadCount[key] || 0) + 1;
      }
    });

    const updateData = {
      lastMessageText: messageText,
      lastMessageTime: now,
      lastMessageSenderId: senderId,
      unreadCount: updatedUnreadCount,
      version: (conversation.version || 0) + 1,
    };

    try {
      const mainUpdateParams = {
        TableName: this.tableName,
        Key: { conversationId },
        UpdateExpression: `set
          lastMessageText = :text,
          lastMessageTime = :time,
          lastMessageSenderId = :senderId,
          unreadCount = :unreadCount,
          version = :version`,
        ExpressionAttributeValues: {
          ":text": messageText,
          ":time": now,
          ":senderId": senderId,
          ":unreadCount": updatedUnreadCount,
          ":version": updateData.version,
        },
        ReturnValues: ReturnValue.ALL_NEW,
      };

      const mainResult = await this.documentClient.send(new UpdateCommand(mainUpdateParams));

      const participantUpdates = conversation.participants.map(participantId => ({
        Update: {
          TableName: this.tableName,
          Key: { conversationId: `${conversationId}#${participantId}` },
          UpdateExpression: `set
            lastMessageText = :text,
            lastMessageTime = :time,
            lastMessageSenderId = :senderId,
            unreadCount = :unreadCount,
            version = :version`,
          ExpressionAttributeValues: {
            ":text": messageText,
            ":time": now,
            ":senderId": senderId,
            ":unreadCount": updatedUnreadCount,
            ":version": updateData.version,
          },
        },
      }));

      for (let i = 0; i < participantUpdates.length; i += 25) {
        const batch = participantUpdates.slice(i, i + 25);
        await this.documentClient.send(new TransactWriteCommand({
          TransactItems: batch,
        }));
      }

      return mainResult.Attributes as DynamoDBConversation;

    } catch (error: any) {
      console.error("Error updating conversation:", error);
      throw error;
    }
  }

  /**
   * Mark conversation as read for a user
   */
  async markAsRead(conversationId: string, userId: number): Promise<void> {
    this.validateParticipant(userId);

    const updateExpression = "set unreadCount.#userId = :zero";
    const expressionAttributeNames = { "#userId": userId.toString() };
    const expressionAttributeValues = { ":zero": 0 };

    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { conversationId },
              UpdateExpression: updateExpression,
              ExpressionAttributeNames: expressionAttributeNames,
              ExpressionAttributeValues: expressionAttributeValues,
              ConditionExpression: "attribute_exists(conversationId)",
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { conversationId: `${conversationId}#${userId}` },
              UpdateExpression: updateExpression,
              ExpressionAttributeNames: expressionAttributeNames,
              ExpressionAttributeValues: expressionAttributeValues,
            },
          },
        ],
      }));

    } catch (error: any) {
      if (error.name === "ConditionalCheckFailedException") {
        throw new Error(`Conversation not found: ${conversationId}`);
      }
      throw error;
    }
  }

  /**
   * Add a participant to a conversation
   */
  async addParticipantToConversation(
    conversationId: string,
    participantId: number,
  ): Promise<DynamoDBConversation> {
    this.validateParticipant(participantId);

    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.participants.includes(participantId)) {
      return conversation;
    }

    const updatedParticipants = [...conversation.participants, participantId];
    const updatedUnreadCount = {
      ...conversation.unreadCount,
      [participantId.toString()]: 0,
    };

    const newVersion = (conversation.version || 0) + 1;

    const newParticipantRecord = {
      ...conversation,
      conversationId: `${conversationId}#${participantId}`,
      participantId,
      participants: updatedParticipants,
      unreadCount: updatedUnreadCount,
      version: newVersion,
    };

    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { conversationId },
              UpdateExpression: "set participants = :participants, unreadCount = :unreadCount, version = :version",
              ExpressionAttributeValues: {
                ":participants": updatedParticipants,
                ":unreadCount": updatedUnreadCount,
                ":version": newVersion,
              },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: newParticipantRecord,
            },
          },
        ],
      }));

      return {
        ...conversation,
        participants: updatedParticipants,
        unreadCount: updatedUnreadCount,
        version: newVersion,
      };

    } catch (error: any) {
      console.error("Error adding participant:", error);
      throw error;
    }
  }

  /**
   * Remove a participant from a conversation
   */
  async removeParticipant(
    conversationId: string,
    userId: number,
  ): Promise<DynamoDBConversation> {
    this.validateParticipant(userId);

    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const updatedParticipants = conversation.participants.filter(p => p !== userId);
    const updatedUnreadCount = { ...conversation.unreadCount };
    delete updatedUnreadCount[userId.toString()];

    const newVersion = (conversation.version || 0) + 1;

    try {
      await this.documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { conversationId },
              UpdateExpression: "set participants = :participants, unreadCount = :unreadCount, version = :version",
              ExpressionAttributeValues: {
                ":participants": updatedParticipants,
                ":unreadCount": updatedUnreadCount,
                ":version": newVersion,
              },
            },
          },
          {
            Delete: {
              TableName: this.tableName,
              Key: { conversationId: `${conversationId}#${userId}` },
            },
          },
        ],
      }));

      return {
        ...conversation,
        participants: updatedParticipants,
        unreadCount: updatedUnreadCount,
        version: newVersion,
      };

    } catch (error: any) {
      console.error("Error removing participant:", error);
      throw error;
    }
  }
}
