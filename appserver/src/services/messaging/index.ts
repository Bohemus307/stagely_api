// src/services/messaging/messagingService.ts
import { PrismaClient } from "@prisma/client";
import { DynamoDBConversationRepository, DynamoDBConversation } from "../../repositories/dynamoDB/conversationRepository";
import { DynamoDBMessageRepository, DynamoDBMessage } from "../../repositories/dynamoDB/messageRepository";
import { DynamoDBConnectionRepository } from "../../repositories/dynamoDB/connectionRepository";
import { NotFoundError } from "../../utils/errors";

export class MessagingService {
  private readonly prisma: PrismaClient;
  private readonly documentClient: any;
  private readonly conversationRepo: DynamoDBConversationRepository;
  private readonly messageRepo: DynamoDBMessageRepository;
  private readonly connectionRepo: DynamoDBConnectionRepository;

  constructor(prisma: PrismaClient, documentClient: any) {
    this.prisma = prisma;
    this.documentClient = documentClient;
    const deploymentEnv = process.env.DEPLOYMENT_ENV || 'staging';
    this.conversationRepo = new DynamoDBConversationRepository(documentClient, deploymentEnv);
    this.messageRepo = new DynamoDBMessageRepository(documentClient, deploymentEnv);
    this.connectionRepo = new DynamoDBConnectionRepository(documentClient, deploymentEnv);
  }

  /**
   * Create a new conversation
   * @param creatorId - User ID of the conversation creator
   * @param participants - Array of participant user IDs
   */
  async createConversation(
    creatorId: number,
    participants: number[],
    type: 'general' = 'general' // Add default value
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
      conversationType: type
    });
  }

  /**
   * Get conversations for a user
   * @param userId - ID of the user
   * @param limit - Optional limit for pagination
   * @param lastEvaluatedKey - Optional pagination key
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
      throw new NotFoundError(`User not found: ${userId}`);
    }

    return this.conversationRepo.getConversationsForUser(userId, limit, lastEvaluatedKey);
  }

  /**
   * Get a conversation by ID
   * @param conversationId - The conversation ID
   * @param userId - The requesting user's ID (for permission check)
   */
  async getConversationById(
    conversationId: string,
    userId: number
  ): Promise<DynamoDBConversation> {
    const conversation = await this.conversationRepo.getConversationById(conversationId);

    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    // Verify user is a participant
    if (!conversation.participants.includes(userId)) {
      throw new Error('User is not a participant in this conversation');
    }

    return conversation;
  }

  /**
   * Send a message in a conversation
   * @param conversationId - The conversation ID
   * @param senderId - ID of the sender
   * @param text - Message text
   */
  async sendMessage(
    conversationId: string,
    senderId: number,
    text: string
  ): Promise<DynamoDBMessage> {
    // Verify sender exists in PostgreSQL
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId }
    });

    if (!sender) {
      throw new NotFoundError(`User not found: ${senderId}`);
    }

    // Get conversation and verify sender is a participant
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    if (!conversation.participants.includes(senderId)) {
      throw new Error('User is not a participant in this conversation');
    }

    // Create message
    const message = await this.messageRepo.createMessage(
      conversationId,
      senderId,
      text,
      conversation.participants
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
   * @param conversationId - The conversation ID
   * @param userId - The requesting user's ID (for permission check)
   * @param limit - Optional limit for pagination
   * @param lastEvaluatedKey - Optional pagination key
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
      throw new NotFoundError(`User not found: ${userId}`);
    }

    // Get conversation and verify user is a participant
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    if (!conversation.participants.includes(userId)) {
      throw new Error('User is not a participant in this conversation');
    }

    // Mark conversation as read for this user
    await this.conversationRepo.markAsRead(conversationId, userId);

    // Get messages
    return this.messageRepo.getMessagesForConversation(conversationId, limit, lastEvaluatedKey);
  }

  /**
   * Mark messages as read
   * @param conversationId - The conversation ID
   * @param userId - The user marking messages as read
   * @param messageIds - Array of message IDs to mark as read
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
      throw new NotFoundError(`User not found: ${userId}`);
    }

    // Get conversation and verify user is a participant
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

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
   * Add a participant to a conversation
   * @param conversationId - The conversation ID
   * @param participantId - ID of the participant to add
   * @param requesterId - ID of the user making the request (for permission check)
   */
  async addParticipantToConversation(
    conversationId: string,
    participantId: number,
    requesterId: number
  ): Promise<DynamoDBConversation> {
    // Verify both users exist in PostgreSQL
    const [requester, participant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: requesterId } }),
      this.prisma.user.findUnique({ where: { id: participantId } })
    ]);

    if (!requester) {
      throw new NotFoundError(`Requester not found: ${requesterId}`);
    }
    if (!participant) {
      throw new NotFoundError(`Participant not found: ${participantId}`);
    }

    // Get conversation and verify requester is a participant
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    if (!conversation.participants.includes(requesterId)) {
      throw new Error('User is not a participant in this conversation');
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
   * @param conversationId - The conversation ID
   * @param participantId - ID of the participant to remove
   * @param requesterId - ID of the user making the request (for permission check)
   */
  async removeParticipantFromConversation(
    conversationId: string,
    participantId: number,
    requesterId: number
  ): Promise<DynamoDBConversation> {
    // Verify both users exist in PostgreSQL
    const [requester, participant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: requesterId } }),
      this.prisma.user.findUnique({ where: { id: participantId } })
    ]);

    if (!requester) {
      throw new NotFoundError(`Requester not found: ${requesterId}`);
    }
    if (!participant) {
      throw new NotFoundError(`Participant not found: ${participantId}`);
    }

    // Get conversation
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    // Check if requester has permission to remove participants
    // For now, allowing users to remove themselves or if they're the conversation creator
    const canRemove = requesterId === participantId || conversation.participants.includes(requesterId);
    if (!canRemove) {
      throw new Error('User does not have permission to remove participants from this conversation');
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
   * Get unread message count for a user
   * @param userId - ID of the user
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
      throw new NotFoundError(`User not found: ${userId}`);
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
          lastMessageTime: conversation.lastMessageTime
        });
      }
    }

    return {
      unreadCount: totalUnread,
      conversationsWithUnread
    };
  }
}
