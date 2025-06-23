import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { TableNames } from "../../config/dynamoTables";
import { ReturnValue } from "@aws-sdk/client-dynamodb";

export interface DynamoDBConversation {
  conversationId: string;
  participants: number[];
  userIds: string;
  conversationType: "general";
  createdAt: number;
  lastMessageText?: string;
  lastMessageTime?: number;
  lastMessageSenderId?: number;
  unreadCount: Record<string, number>;
  version: number;
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
   * Create a new conversation - MUCH SIMPLER
   */
  async createConversation(
    data: Omit<
      DynamoDBConversation,
      "conversationId" | "createdAt" | "unreadCount" | "version" | "userIds"
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

    const conversation: DynamoDBConversation = {
      conversationId,
      participants: data.participants,
      userIds: data.participants.sort((a, b) => a - b).join(','), // NEW: Store as string
      conversationType: data.conversationType || "general",
      lastMessageText: data.lastMessageText,
      lastMessageTime: data.lastMessageTime || now,
      lastMessageSenderId: data.lastMessageSenderId,
      createdAt: now,
      unreadCount,
      version: 1,
    };

    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: conversation,
    }));

    console.log(`Created conversation ${conversationId} with ${data.participants.length} participants`);
    return conversation;
  }

  /**
   * Get a conversation by ID
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
   * Get conversations for a user
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

    const userIdStr = userId.toString();

    const params = {
      TableName: this.tableName,
      FilterExpression: "contains(userIds, :userId)",
      ExpressionAttributeValues: {
        ":userId": userIdStr,
      },
      Limit: limit * 3,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
    };

    const result = await this.documentClient.send(new ScanCommand(params));

    const filteredConversations = (result.Items || []).filter(item => {
      const userIds = item.userIds?.split(',') || [];
      return userIds.includes(userIdStr);
    }).slice(0, limit);

    console.log(`Found ${filteredConversations.length} conversations for user ${userId}`);

    return {
      conversations: filteredConversations as DynamoDBConversation[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Update conversation with new message
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

    const updateParams = {
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
        ":version": (conversation.version || 0) + 1,
      },
      ReturnValues: ReturnValue.ALL_NEW,
    };

    const result = await this.documentClient.send(new UpdateCommand(updateParams));
    return result.Attributes as DynamoDBConversation;
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(conversationId: string, userId: number): Promise<void> {
    this.validateParticipant(userId);

    await this.documentClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: "set unreadCount.#userId = :zero",
      ExpressionAttributeNames: {
        "#userId": userId.toString(),
      },
      ExpressionAttributeValues: {
        ":zero": 0,
      },
      ConditionExpression: "attribute_exists(conversationId)",
    }));
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
    const updatedUserIds = updatedParticipants.sort((a, b) => a - b).join(',');
    const updatedUnreadCount = {
      ...conversation.unreadCount,
      [participantId.toString()]: 0,
    };

    const result = await this.documentClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: "set participants = :participants, userIds = :userIds, unreadCount = :unreadCount, version = :version",
      ExpressionAttributeValues: {
        ":participants": updatedParticipants,
        ":userIds": updatedUserIds,
        ":unreadCount": updatedUnreadCount,
        ":version": (conversation.version || 0) + 1,
      },
      ReturnValues: ReturnValue.ALL_NEW,
    }));

    return result.Attributes as DynamoDBConversation;
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
    const updatedUserIds = updatedParticipants.sort((a, b) => a - b).join(',');
    const updatedUnreadCount = { ...conversation.unreadCount };
    delete updatedUnreadCount[userId.toString()];

    const result = await this.documentClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: "set participants = :participants, userIds = :userIds, unreadCount = :unreadCount, version = :version",
      ExpressionAttributeValues: {
        ":participants": updatedParticipants,
        ":userIds": updatedUserIds,
        ":unreadCount": updatedUnreadCount,
        ":version": (conversation.version || 0) + 1,
      },
      ReturnValues: ReturnValue.ALL_NEW,
    }));

    return result.Attributes as DynamoDBConversation;
  }
}

