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

  // In MessagingService constructor
constructor(prisma: PrismaClient, documentClient: any) {
  this.prisma = prisma;
  this.documentClient = documentClient;
  const deploymentEnv = process.env.DEPLOYMENT_ENV || 'staging';
  this.conversationRepo = new DynamoDBConversationRepository(documentClient, deploymentEnv);
  this.messageRepo = new DynamoDBMessageRepository(documentClient, deploymentEnv);
  this.connectionRepo = new DynamoDBConnectionRepository(documentClient, deploymentEnv);
}


  /**
   * Initialize a user for messaging
   * Now just validates user exists in PostgreSQL
   */
  async initializeUser(auth0Id: string): Promise<any> {
    console.log("Initializing user with auth0Id:", auth0Id);
    // Get user from PostgreSQL
    const pgUser = await this.prisma.user.findUnique({
      where: { auth0Id }
    });
    console.log("Found pgUser:", pgUser);
    if (!pgUser) {
      throw new Error(`User not found with Auth0 ID: ${auth0Id}`);
    }

    const messagingUser = {
      userId: pgUser.id,
      email: pgUser.email,
      firstName: pgUser.firstName,
      lastName: pgUser.lastName,
      profilePictureUrl: pgUser.profilePictureUrl || undefined,
      lastSeen: Date.now(),
      createdAt: pgUser.createdAt.getTime(),
      updatedAt: pgUser.updatedAt.getTime()
    };

    console.log("Returning messagingUser:", messagingUser);

    return messagingUser;
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



    return this.conversationRepo.createConversation({
      participants,
      conversationType: 'general',
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

    return this.conversationRepo.getConversationsForUser(userId, limit, lastEvaluatedKey);

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
   * Get conversation by ID
   */
  async getConversationById(conversationId: string): Promise<DynamoDBConversation | null> {
    return this.conversationRepo.getConversationById(conversationId);

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


        conversationsWithUnread.push({
          conversationId: conversation.conversationId,
          unreadCount,
          lastMessageText: conversation.lastMessageText,
          lastMessageTime: conversation.lastMessageTime,
        });
      }
    }

    return {
      unreadCount: totalUnread,
      conversationsWithUnread
    };
  }
}
