// src/services/messaging/messagingService.ts
import { PrismaClient } from "@prisma/client";
import { DynamoDBConversationRepository, DynamoDBConversation } from "../../repositories/dynamoDB/conversationRepository";
import { DynamoDBMessageRepository, DynamoDBMessage } from "../../repositories/dynamoDB/messageRepository";
import { DynamoDBConnectionRepository } from "../../repositories/dynamoDB/connectionRepository";

export class MessagingService {
  private readonly prisma: PrismaClient;
  private readonly documentClient: any;
  private readonly conversationRepo: DynamoDBConversationRepository;
  private readonly messageRepo: DynamoDBMessageRepository;
  private readonly connectionRepo: DynamoDBConnectionRepository;

  constructor(prisma: PrismaClient, documentClient: any) {
    this.prisma = prisma;
    this.documentClient = documentClient;
    this.conversationRepo = new DynamoDBConversationRepository(documentClient);
    this.messageRepo = new DynamoDBMessageRepository(documentClient);
    this.connectionRepo = new DynamoDBConnectionRepository(documentClient);
  }


  /**
   * Initialize a user for messaging
   * Now just validates user exists in PostgreSQL
   */
  async initializeUser(auth0Id: string): Promise<any> {
    // Get user from PostgreSQL
    const pgUser = await this.prisma.user.findUnique({
      where: { auth0Id }
    });

    if (!pgUser) {
      throw new Error(`User not found with Auth0 ID: ${auth0Id}`);
    }

    return {
      userId: pgUser.id,
      email: pgUser.email,
      firstName: pgUser.firstName,
      lastName: pgUser.lastName,
      profilePictureUrl: pgUser.profilePictureUrl || undefined,
      lastSeen: Date.now(),
      createdAt: pgUser.createdAt.getTime(),
      updatedAt: pgUser.updatedAt.getTime()
    };
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    creatorId: number,
    participants: number[],
    type: 'property_related' | 'incident_related' | 'general',
    propertyId?: number,
    incidentId?: number
  ): Promise<DynamoDBConversation> {
    // Ensure creator is in the participants list
    if (!participants.includes(creatorId)) {
      participants.push(creatorId);
    }

    // Validate all participants exist in PostgreSQL
    const validUsers = await this.prisma.user.findMany({
      where: { id: { in: participants } },
      select: { id: true }
    });

    if (validUsers.length !== participants.length) {
      throw new Error('One or more participants do not exist');
    }

    // If property related, get property details and validate
    let propertyAddress: string | undefined;

    if (propertyId) {
      const property = await this.prisma.property.findUnique({
        where: { id: propertyId },
        select: { address: true, city: true, state: true }
      });

      if (!property) {
        throw new Error(`Property not found: ${propertyId}`);
      }

      propertyAddress = `${property.address}, ${property.city}, ${property.state}`;
    }

    // If incident related, validate incident
    if (incidentId) {
      const incident = await this.prisma.incident.findUnique({
        where: { id: incidentId }
      });

      if (!incident) {
        throw new Error(`Incident not found: ${incidentId}`);
      }
    }

    return this.conversationRepo.createConversation({
      participants,
      propertyId,
      propertyAddress,
      conversationType: type,
      incidentId
    });
  }

  /**
   * Get conversations for a user
   */
  async getConversationsForUser(
    userId: number,
    limit: number = 20,
    lastEvaluatedKey?: any
  ): Promise<{
    conversations: DynamoDBConversation[];
    lastEvaluatedKey?: any;
  }> {
    // Verify user exists in PostgreSQL
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const result = await this.conversationRepo.getConversationsForUser(userId, limit, lastEvaluatedKey);

    // Enrich conversations with PostgreSQL data
    const enrichedConversations = await Promise.all(
      result.conversations.map(async (conversation) => {
        // Add property data if it exists
        if (conversation.propertyId) {
          const property = await this.prisma.property.findUnique({
            where: { id: conversation.propertyId },
            select: { address: true, city: true, state: true }
          });

          if (property) {
            conversation.propertyAddress = `${property.address}, ${property.city}, ${property.state}`;
          }
        }

        // Don't need to enrich participants as they're just IDs
        return conversation;
      })
    );

    return {
      conversations: enrichedConversations,
      lastEvaluatedKey: result.lastEvaluatedKey
    };
  }

  /**
   * Create property conversation for all property users
   */
  async createPropertyConversation(
    creatorId: number,
    propertyId: number,
    initialMessage?: string
  ): Promise<{
    conversation: DynamoDBConversation;
    message?: DynamoDBMessage;
  }> {
    // Verify creator exists
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId }
    });

    if (!creator) {
      throw new Error(`User not found: ${creatorId}`);
    }

    // Verify property exists
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { address: true, city: true, state: true }
    });

    if (!property) {
      throw new Error(`Property not found: ${propertyId}`);
    }

    // Get all users associated with the property
    const propertyUsers = await this.prisma.user.findMany({
      where: {
        OR: [
          { properties: { some: { id: propertyId } } },
          { id: creatorId } // Include creator even if not directly associated
        ]
      },
      select: { id: true }
    });

    const allParticipants = [...new Set(propertyUsers.map(u => u.id))];

    // Create conversation in DynamoDB
    const conversation = await this.conversationRepo.createConversation({
      participants: allParticipants,
      propertyId,
      propertyAddress: `${property.address}, ${property.city}, ${property.state}`,
      conversationType: 'property_related'
    });

    let message: DynamoDBMessage | undefined;

    if (initialMessage && initialMessage.trim().length > 0) {
      message = await this.messageRepo.createMessage(
        conversation.conversationId,
        creatorId,
        initialMessage.trim(),
        allParticipants
      );

      await this.conversationRepo.updateWithNewMessage(
        conversation.conversationId,
        creatorId,
        initialMessage.trim()
      );
    }

    return { conversation, message };
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(
    conversationId: string,
    senderId: number,
    text: string,
  ): Promise<DynamoDBMessage> {
    // Verify sender exists in PostgreSQL
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId }
    });

    if (!sender) {
      throw new Error(`User not found: ${senderId}`);
    }

    // Get conversation
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Check if sender is a participant
    if (!conversation.participants.includes(senderId)) {
      throw new Error('User is not a participant in this conversation');
    }

    // Create message
    const message = await this.messageRepo.createMessage(
      conversationId,
      senderId,
      text,
      conversation.participants,
    );

    // Update conversation with new message info
    await this.conversationRepo.updateWithNewMessage(
      conversationId,
      senderId,
      text
    );

    return message;
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(
    conversationId: string,
    userId: number,
    limit: number = 20,
    lastEvaluatedKey?: any
  ): Promise<{
    messages: DynamoDBMessage[];
    lastEvaluatedKey?: any;
  }> {
    // Verify user exists in PostgreSQL
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Get conversation
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Check if user is a participant
    if (!conversation.participants.includes(userId)) {
      throw new Error('User is not a participant in this conversation');
    }

    // Mark conversation as read for this user
    await this.conversationRepo.markAsRead(conversationId, userId);

    // Get messages
    const result = await this.messageRepo.getMessagesForConversation(conversationId, limit, lastEvaluatedKey);

    // Enrich messages with sender info from PostgreSQL
    const senderIds = [...new Set(result.messages.map(m => m.senderId))];
    const senders = await this.prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, firstName: true, lastName: true, profilePictureUrl: true }
    });

    const sendersMap = new Map(senders.map(s => [s.id, s]));

    const enrichedMessages = result.messages.map(message => {
      const sender = sendersMap.get(message.senderId);
      return {
        ...message,
        senderInfo: sender ? {
          firstName: sender.firstName,
          lastName: sender.lastName,
          profilePictureUrl: sender.profilePictureUrl
        } : undefined
      };
    });

    return {
      messages: enrichedMessages,
      lastEvaluatedKey: result.lastEvaluatedKey
    };
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(
    conversationId: string,
    userId: number,
    messageIds: string[]
  ): Promise<void> {
    // Verify user exists in PostgreSQL
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Get conversation
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Check if user is a participant
    if (!conversation.participants.includes(userId)) {
      throw new Error('User is not a participant in this conversation');
    }

    // Mark conversation as read
    await this.conversationRepo.markAsRead(conversationId, userId);

    // Mark individual messages as read
    await this.messageRepo.batchUpdateMessageStatus(
      messageIds.map(messageId => ({ messageId, conversationId })),
      userId,
      'READ'
    );
  }

  /**
   * Save a WebSocket connection
   */
  async saveConnection(connectionId: string, userId: number, deviceId?: string): Promise<void> {
    // Verify user exists in PostgreSQL
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    await this.connectionRepo.saveConnection(connectionId, userId, deviceId);
  }

  /**
   * Delete a WebSocket connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    await this.connectionRepo.deleteConnection(connectionId);
  }

  /**
   * Get all connections for a user
   * This is used to send messages to all of a user's devices
   */
  async getUserConnections(userId: number): Promise<string[]> {
    // Verify user exists in PostgreSQL
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const connections = await this.connectionRepo.getConnectionsForUser(userId);
    return connections.map(c => c.connectionId);
  }

  /**
   * Get conversation by ID
   */
  async getConversationById(conversationId: string): Promise<DynamoDBConversation | null> {
    const conversation = await this.conversationRepo.getConversationById(conversationId);

    if (conversation) {
      // Enrich with property data if it exists
      if (conversation.propertyId) {
        const property = await this.prisma.property.findUnique({
          where: { id: conversation.propertyId },
          select: { address: true, city: true, state: true }
        });

        if (property) {
          conversation.propertyAddress = `${property.address}, ${property.city}, ${property.state}`;
        }
      }
    }

    return conversation;
  }

  /**
   * Add a participant to a conversation
   */
  async addParticipantToConversation(
    conversationId: string,
    participantId: number
  ): Promise<DynamoDBConversation> {
    // Verify participant exists in PostgreSQL
    const participant = await this.prisma.user.findUnique({
      where: { id: participantId }
    });

    if (!participant) {
      throw new Error(`User not found: ${participantId}`);
    }

    // Get conversation
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Check if user is already a participant
    if (conversation.participants.includes(participantId)) {
      return conversation; // Already a participant
    }

    // Update the conversation
    return this.conversationRepo.addParticipantToConversation(
      conversationId,
      participantId
    );
  }

  /**
   * Remove a participant from a conversation
   */
  async removeParticipantFromConversation(
    conversationId: string,
    participantId: number
  ): Promise<DynamoDBConversation> {
    // Verify participant exists in PostgreSQL
    const participant = await this.prisma.user.findUnique({
      where: { id: participantId }
    });

    if (!participant) {
      throw new Error(`User not found: ${participantId}`);
    }

    // Get conversation
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Check if user is actually a participant
    if (!conversation.participants.includes(participantId)) {
      return conversation; // Not a participant, nothing to do
    }

    // Remove participant from the conversation
    return this.conversationRepo.removeParticipant(
      conversationId,
      participantId
    );
  }

  /**
   * Get conversations for a property
   */
  async getConversationsForProperty(
    propertyId: number,
    limit: number = 20,
    lastEvaluatedKey?: any
  ): Promise<{
    conversations: DynamoDBConversation[];
    lastEvaluatedKey?: any;
  }> {
    // Verify property exists in PostgreSQL
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId }
    });

    if (!property) {
      throw new Error(`Property not found: ${propertyId}`);
    }

    const result = await this.conversationRepo.getConversationsForProperty(propertyId, limit, lastEvaluatedKey);

    // Enrich with property data
    const enrichedConversations = result.conversations.map(conversation => {
      return {
        ...conversation,
        propertyAddress: `${property.address}, ${property.city}, ${property.state}`
      };
    });

    return {
      conversations: enrichedConversations,
      lastEvaluatedKey: result.lastEvaluatedKey
    };
  }

  /**
   * Get property incidents with conversations
   */
  async getPropertyIncidentsWithConversations(
    propertyId: number,
    userId: number
  ): Promise<any[]> {
    // Verify property exists in PostgreSQL
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId }
    });

    if (!property) {
      throw new Error(`Property not found: ${propertyId}`);
    }

    // Get incidents for the property
    const incidents = await this.prisma.incident.findMany({
      where: {
        propertyId: propertyId
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // For each incident, check if there's a conversation
    const incidentsWithConversations = await Promise.all(
      incidents.map(async (incident) => {
        // Find conversation for this incident
        const conversationsResult = await this.conversationRepo.getConversationsForIncident(incident.id);

        // Filter for conversations that include this user
        const incidentConversation = conversationsResult.conversations.find(
          (conv) => conv.participants.includes(userId)
        );

        return {
          incident,
          conversation: incidentConversation || null
        };
      })
    );

    return incidentsWithConversations;
  }

  /**
   * Get unread conversation count for user
   */
  async getUnreadCount(userId: number): Promise<{
    unreadCount: number;
    conversationsWithUnread: any[];
  }> {
    // Verify user exists in PostgreSQL
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Get all conversations for user
    const result = await this.conversationRepo.getConversationsForUser(userId, 100);

    // Count unread messages
    let totalUnread = 0;
    const conversationsWithUnread = [];

    for (const conversation of result.conversations) {
      const userIdStr = userId.toString();
      const unreadCount = conversation.unreadCount?.[userIdStr] || 0;

      if (unreadCount > 0) {
        totalUnread += unreadCount;

        // Enrich with property data if needed
        let propertyData = null;
        if (conversation.propertyId) {
          const property = await this.prisma.property.findUnique({
            where: { id: conversation.propertyId },
            select: { address: true, city: true, state: true }
          });

          if (property) {
            propertyData = {
              id: conversation.propertyId,
              address: property.address,
              city: property.city,
              state: property.state
            };
          }
        }

        conversationsWithUnread.push({
          conversationId: conversation.conversationId,
          unreadCount,
          lastMessageText: conversation.lastMessageText,
          lastMessageTime: conversation.lastMessageTime,
          property: propertyData
        });
      }
    }

    return {
      unreadCount: totalUnread,
      conversationsWithUnread
    };
  }
}
