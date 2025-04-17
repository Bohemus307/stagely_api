// src/repositories/dynamoDB/conversationRepository.ts
import {
    PutCommand,
    GetCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand,
    TransactWriteCommand
  } from "@aws-sdk/lib-dynamodb";
  import { v4 as uuidv4 } from 'uuid';
  import { TableNames } from "../../config/dynamoTables";

  export interface DynamoDBConversation {
    conversationId: string;
    participants: number[];
    propertyId?: number;
    propertyAddress?: string;
    conversationType: 'property_related' | 'incident_related' | 'general';
    incidentId?: number;
    createdAt: number;
    lastMessageText?: string;
    lastMessageTime?: number;
    lastMessageSenderId?: number;
    unreadCount: Record<string, number>;
  }

  export class DynamoDBConversationRepository {
    private readonly tableName: string;
    private readonly documentClient: any;

    constructor(documentClient: any, deploymentEnv: string = process.env.NODE_ENV || 'development') {
      this.documentClient = documentClient;
      // Append environment to table name
      this.tableName = `${TableNames.CONVERSATIONS}-${deploymentEnv}`;
    }

    /**
     * Create a new conversation
     */
    async createConversation(data: Omit<DynamoDBConversation, 'conversationId' | 'createdAt' | 'unreadCount'>): Promise<DynamoDBConversation> {
      const conversationId = `conv_${uuidv4()}`;
      const now = Date.now();

      // Create unreadCount object with 0 count for all participants
      const unreadCount: Record<string, number> = {};
      data.participants.forEach(participantId => {
        unreadCount[participantId.toString()] = 0;
      });

      const conversation: DynamoDBConversation = {
        conversationId,
        participants: data.participants,
        propertyId: data.propertyId,
        propertyAddress: data.propertyAddress,
        conversationType: data.conversationType,
        incidentId: data.incidentId,
        lastMessageText: data.lastMessageText,
        lastMessageTime: data.lastMessageTime,
        lastMessageSenderId: data.lastMessageSenderId,
        createdAt: now,
        unreadCount
      };

      // Create base item
      const putParams = {
        TableName: this.tableName,
        Item: conversation
      };

      await this.documentClient.send(new PutCommand(putParams));

      const transactItems = data.participants.map(participantId => ({
        Put: {
          TableName: this.tableName,
          Item: {
            ...conversation,
            participantId
          }
        }
      }));

      if (transactItems.length > 0) {
        await this.documentClient.send(new TransactWriteCommand({
          TransactItems: transactItems
        }));
      }

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
      const params = {
        TableName: this.tableName,
        IndexName: 'participant-index',
        KeyConditionExpression: 'participantId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId.toString()
        },
        Limit: limit,
        ScanIndexForward: false,

      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    };

    const result = await this.documentClient.send(new QueryCommand(params));

    return {
      conversations: (result.Items || []) as DynamoDBConversation[],
      lastEvaluatedKey: result.LastEvaluatedKey
    };
  }

  /**
   * Get conversations for a property
   */
  async getConversationsForProperty(propertyId: number, limit: number = 20, lastEvaluatedKey?: any): Promise<{
    conversations: DynamoDBConversation[];
    lastEvaluatedKey?: any;
  }> {
    const params = {
      TableName: this.tableName,
      IndexName: 'propertyId-index',
      KeyConditionExpression: 'propertyId = :propertyId',
      ExpressionAttributeValues: {
        ':propertyId': propertyId
      },
      Limit: limit,
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    };

    const result = await this.documentClient.send(new QueryCommand(params));

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
        unreadCount = :unreadCount`,
      ExpressionAttributeValues: {
        ':text': messageText,
        ':time': now,
        ':senderId': senderId,
        ':unreadCount': updatedUnreadCount
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await this.documentClient.send(new UpdateCommand(params));
    return result.Attributes as DynamoDBConversation;
  }

  /**
   * Mark conversation as read for a user
   */
  async markAsRead(conversationId: string, userId: number): Promise<void> {
    // Get current conversation
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Reset unread count for this user
    const updatedUnreadCount = { ...conversation.unreadCount };
    updatedUnreadCount[userId.toString()] = 0;

    const params = {
      TableName: this.tableName,
      Key: { conversationId },
      UpdateExpression: 'set unreadCount = :unreadCount',
      ExpressionAttributeValues: {
        ':unreadCount': updatedUnreadCount
      }
    };

    await this.documentClient.send(new UpdateCommand(params));
  }
  /**
 * Add a participant to a conversation
 */
  async addParticipantToConversation(
    conversationId: string,
    participantId: number
  ): Promise<DynamoDBConversation> {
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
      UpdateExpression: 'set participants = :participants, unreadCount = :unreadCount',
      ExpressionAttributeValues: {
        ':participants': updatedParticipants,
        ':unreadCount': updatedUnreadCount
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await this.documentClient.send(new UpdateCommand(params));

    return result.Attributes as DynamoDBConversation;
  }



  /**
   * Remove a participant from a conversation
   */
  async removeParticipant(conversationId: string, userId: number): Promise<DynamoDBConversation> {
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
      UpdateExpression: 'set participants = :participants, unreadCount = :unreadCount',
      ExpressionAttributeValues: {
        ':participants': updatedParticipants,
        ':unreadCount': updatedUnreadCount
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await this.documentClient.send(new UpdateCommand(params));

    // Remove entry from the participant-index GSI
    await this.documentClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: {
        conversationId,
        participantId: userId
      }
    }));

    return result.Attributes as DynamoDBConversation;
  }
}
