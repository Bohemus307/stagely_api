// src/services/messaging/messagingService.ts
import { PrismaClient } from "@prisma/client";
import { DynamoDBUserRepository, DynamoDBUser } from "../../repositories/dynamoDB/userRepository";
import { DynamoDBConversationRepository, DynamoDBConversation } from "../../repositories/dynamoDB/conversationRepository";
import { DynamoDBMessageRepository, DynamoDBMessage } from "../../repositories/dynamoDB/messageRepository";
import { DynamoDBConnectionRepository } from "../../repositories/dynamoDB/connectionRepository";


export class MessagingService {
  private readonly prisma: PrismaClient;
  private readonly documentClient: any;
  private readonly userRepo: DynamoDBUserRepository;
  private readonly conversationRepo: DynamoDBConversationRepository;
  private readonly messageRepo: DynamoDBMessageRepository;
  private readonly connectionRepo: DynamoDBConnectionRepository;

  constructor(prisma: PrismaClient, documentClient: any) {
    this.prisma = prisma;
    this.documentClient = documentClient;
    this.userRepo = new DynamoDBUserRepository(documentClient);
    this.conversationRepo = new DynamoDBConversationRepository(documentClient);
    this.messageRepo = new DynamoDBMessageRepository(documentClient);
    this.connectionRepo = new DynamoDBConnectionRepository(documentClient);
  }

  /**
   * Initialize a user for messaging if they don't exist yet
   */
  async initializeUser(auth0Id: string): Promise<DynamoDBUser> {
    // First check if user already exists in DynamoDB
    let dynamoUser = await this.userRepo.getUserById(auth0Id);

    if (!dynamoUser) {
      // Get user from PostgreSQL
      const pgUser = await this.prisma.user.findUnique({
        where: { auth0Id }
      });

      if (!pgUser) {
        throw new Error(`User not found with Auth0 ID: ${auth0Id}`);
      }

      // Create user in DynamoDB
      dynamoUser = await this.userRepo.createUser({
        userId: auth0Id,
        email: pgUser.email,
        firstName: pgUser.firstName,
        lastName: pgUser.lastName,
        profilePictureUrl: pgUser.profilePictureUrl || undefined,
        lastSeen: Date.now(),
        createdAt: pgUser.createdAt.getTime(),
        updatedAt: pgUser.updatedAt.getTime()
      });
    }

    return dynamoUser;
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

    // If property related, get property details
    let propertyAddress: string | undefined;

    if (propertyId && type === 'property_related') {
      const property = await this.prisma.property.findUnique({
        where: { id: propertyId },
        select: { address: true, city: true, state: true }
      });

      if (property) {
        propertyAddress = `${property.address}, ${property.city}, ${property.state}`;
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
    return this.conversationRepo.getConversationsForUser(userId, limit, lastEvaluatedKey);
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
    // Pagination setup
    const pageSize = 100;
    let skip = 0;
    let allParticipants: number[] = [];

    while (true) {
      const users: { id: number }[] = await this.prisma.user.findMany({
        where: {
          properties: {
            some: { id: propertyId }
          }
        },
        select: { id: true },
        skip,
        take: pageSize
      });

      allParticipants.push(...users.map((u) => u.id));

      if (users.length < pageSize) break;
      skip += pageSize;
    }

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { address: true, city: true, state: true }
    });

    if (!property) {
      throw new Error(`Property not found: ${propertyId}`);
    }

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

    return this.messageRepo.getMessagesForConversation(conversationId, limit, lastEvaluatedKey);
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(
    conversationId: string,
    userId: number,
    messageIds: string[]
  ): Promise<void> {
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
    const connections = await this.connectionRepo.getConnectionsForUser(userId);
    return connections.map(c => c.connectionId);
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
  const participants = conversation.participants.filter(id => id !== participantId);

  // Update the conversation
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
  return this.conversationRepo.getConversationsForProperty(propertyId, limit, lastEvaluatedKey);
}
}
