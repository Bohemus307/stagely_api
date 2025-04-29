// src/repositories/dynamoDB/conversationRepository.ts
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from 'uuid';
import { TableNames } from "../../config/dynamoTables";
import { ReturnValue } from "@aws-sdk/client-dynamodb";

export interface DynamoDBConversation {
  conversationId: string;
  participants: number[];
  conversationType: 'general';
  createdAt: number;
  lastMessageText?: string;
  lastMessageTime?: number;
  lastMessageSenderId?: number;
  unreadCount: Record<string, number>;
  version: number; // Added for optimistic locking
}

export class DynamoDBConversationRepository {
  private readonly tableName: string;
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(documentClient: any, deploymentEnv: string = process.env.NODE_ENV || 'development') {
    this.documentClient = documentClient;
    // Append environment to table name
    this.tableName = `${TableNames.CONVERSATIONS}-${deploymentEnv}`;
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
   * Create a new conversation
   */
  async createConversation(data: Omit<DynamoDBConversation, 'conversationId' | 'createdAt' | 'unreadCount' | 'version'>): Promise<DynamoDBConversation> {
    const conversationId = `conv_${uuidv4()}`;
    const now = Date.now();

    // Create unreadCount object with 0 count for all participants
    const unreadCount: Record<string, number> = {};
    data.participants.forEach(participantId => {
      this.validateParticipant(participantId);
      unreadCount[participantId.toString()] = 0;
    });

    const conversation: DynamoDBConversation = {
      conversationId,
      participants: data.participants,
      conversationType: data.conversationType || 'general',
      lastMessageText: data.lastMessageText,
      lastMessageTime: data.lastMessageTime,
      lastMessageSenderId: data.lastMessageSenderId,
      createdAt: now,
      unreadCount,
      version: 1
    };

    // Create base item
    const putParams = {
      TableName: this.tableName,
      Item: conversation
    };

    await this.documentClient.send(new PutCommand(putParams));
    return conversation;
  }

  /**
   * Get a conversation by ID
   */
  async getConversationById(conversationId: string): Promise<DynamoDBConversation | null> {
    const params = {
      TableName: this.tableName,
      Key: { conversationId }
    };

    const result = await this.documentClient.send(new GetCommand(params));
    return result.Item as DynamoDBConversation || null;
  }

  /**
   * Get all conversations for a user
   */
  async getConversationsForUser(userId: number, limit: number = 20, lastEvaluatedKey?: any): Promise<{
    conversations: DynamoDBConversation[];
    lastEvaluatedKey?: Record<string, any>;
  }> {
    this.validateParticipant(userId);

    const params = {
      TableName: this.tableName,
      FilterExpression: 'contains(participants, :userId)', // Filter on participants array
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    };

    const result = await this.documentClient.send(new ScanCommand(params));
    console.log("Raw result.Items:", JSON.stringify(result.Items, null, 2));

    return {
      conversations: (result.Items || []) as DynamoDBConversation[],
      lastEvaluatedKey: result.LastEvaluatedKey
    };
  }

  /**
   * Update conversation with new message info
   */
  async updateWithNewMessage(
    conversationId: string,
    senderId: number,
    messageText: string
  ): Promise<DynamoDBConversation> {
    this.validateParticipant(senderId);

    const now = Date.now();

    // Get current conversation
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Update unread counts for each participant (except sender)
    const updatedUnreadCount = { ...conversation.unreadCount };
    conversation.participants.forEach(participantId => {
      if (participantId !== senderId) {
        const key = participantId.toString();
        updatedUnreadCount[key] = (updatedUnreadCount[key] || 0) + 1;
      }
    });


    const params = {
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: `set
        lastMessageText = :text,
        lastMessageTime = :time,
        lastMessageSenderId = :senderId,
        unreadCount = :unreadCount,
        version = if_not_exists(version, :zero) + :one`,
      ExpressionAttributeValues: {
        ':text': messageText,
        ':time': now,
        ':senderId': senderId,
        ':unreadCount': updatedUnreadCount,
        ':zero': 0,
        ':one': 1
      },
      ReturnValues: ReturnValue.ALL_NEW
    };

    try {
      const result = await this.documentClient.send(new UpdateCommand(params));
      return result.Attributes as DynamoDBConversation;
    } catch (error: any) {
      console.error('Error updating conversation:', error);
      throw error;
    }
  }
  
  /**
   * Mark conversation as read for a user
   */
  async markAsRead(conversationId: string, userId: number): Promise<void> {
    this.validateParticipant(userId);

    const params = {
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: 'set unreadCount.#userId = :zero',
      ExpressionAttributeNames: {
        '#userId': userId.toString()
      },
      ExpressionAttributeValues: {
        ':zero': 0
      },
      ConditionExpression: 'attribute_exists(conversationId)'
    };

    try {
      await this.documentClient.send(new UpdateCommand(params));
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
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
    participantId: number
  ): Promise<DynamoDBConversation> {
    this.validateParticipant(participantId);

    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.participants.includes(participantId)) {
      return conversation; // Already a participant
    }

    const updatedParticipants = [...conversation.participants, participantId];
    const updatedUnreadCount = {
      ...conversation.unreadCount,
      [participantId.toString()]: 0
    };

    const params = {
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: 'set participants = :participants, unreadCount = :unreadCount, version = :newVersion',
      ExpressionAttributeValues: {
        ':participants': updatedParticipants,
        ':unreadCount': updatedUnreadCount,
        ':currentVersion': conversation.version,
        ':newVersion': conversation.version + 1
      },
      ConditionExpression: 'version = :currentVersion',
      ReturnValues: ReturnValue.ALL_NEW
    };

    try {
      const result = await this.documentClient.send(new UpdateCommand(params));
      return result.Attributes as DynamoDBConversation;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new Error('Conversation was modified by another process. Please retry.');
      }
      throw error;
    }
  }

  /**
   * Remove a participant from a conversation
   */
  async removeParticipant(conversationId: string, userId: number): Promise<DynamoDBConversation> {
    this.validateParticipant(userId);

    // Get current conversation
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Filter out the user
    const updatedParticipants = conversation.participants.filter(p => p !== userId);

    // Remove user from unread counts
    const updatedUnreadCount = { ...conversation.unreadCount };
    delete updatedUnreadCount[userId.toString()];

    const params = {
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: 'set participants = :participants, unreadCount = :unreadCount, version = :newVersion',
      ExpressionAttributeValues: {
        ':participants': updatedParticipants,
        ':unreadCount': updatedUnreadCount,
        ':currentVersion': conversation.version,
        ':newVersion': conversation.version + 1
      },
      ConditionExpression: 'version = :currentVersion',
      ReturnValues: ReturnValue.ALL_NEW
    };

    try {
      const result = await this.documentClient.send(new UpdateCommand(params));
      return result.Attributes as DynamoDBConversation;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new Error('Conversation was modified by another process. Please retry.');
      }
      throw error;
    }
  }
}
