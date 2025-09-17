// src/services/messaging/index.ts
import { PrismaClient } from "@prisma/client";
import {
  DynamoDBConversationRepository,
  DynamoDBConversation,
} from "../../repositories/dynamoDB/conversationRepository";
import {
  DynamoDBMessageRepository,
  DynamoDBMessage,
} from "../../repositories/dynamoDB/messageRepository";
import { NotFoundError } from "../../utils/errors";
import { UserRepository } from "../../repositories/userRepository";

export class MessagingService {
  private readonly prisma: PrismaClient;
  private readonly documentClient: any;
  private readonly conversationRepo: DynamoDBConversationRepository;
  private readonly messageRepo: DynamoDBMessageRepository;
  private readonly userRepo: UserRepository;

  constructor(prisma: PrismaClient, documentClient: any) {
    this.prisma = prisma;
    this.documentClient = documentClient;
    const deploymentEnv = process.env.DEPLOYMENT_ENV || "staging";
    this.conversationRepo = new DynamoDBConversationRepository(
      documentClient,
      deploymentEnv
    );
    this.messageRepo = new DynamoDBMessageRepository(documentClient, deploymentEnv);
    this.userRepo = new UserRepository(prisma);
  }

  /**
   * Create a new conversation between existing users
   * @param creatorId - User ID of the conversation creator
   * @param participants - Array of participant user IDs (existing users)
   * @param initialMessage - Optional initial message to send
   */
  async createConversation(
    creatorId: number,
    participants: number[],
    initialMessage?: string
  ): Promise<{
    conversation: DynamoDBConversation;
    message?: DynamoDBMessage;
  }> {
    // Ensure creator is in the participants list
    if (!participants.includes(creatorId)) {
      participants.push(creatorId);
    }

    // Validate that all participants exist
    const validUsers = await this.userRepo.getUsersByIds(participants);

    // Check if all participants exist
    if (validUsers.length !== participants.length) {
      const foundIds = validUsers.map((user) => user.id);
      const missingIds = participants.filter((id) => !foundIds.includes(id));
      throw new Error(`Users not found: ${missingIds.join(", ")}`);
    }

    // Create the conversation
    const conversation = await this.conversationRepo.createConversation({
      participants,
      conversationType: "general"
    });

    // Send initial message if provided
    let message;
    if (initialMessage) {
      message = await this.sendMessage(
        conversation.conversationId,
        creatorId,
        initialMessage
      );
    }

    return {
      conversation,
      message
    };
  }

  /**
   * Get all conversations for a user
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
    // Verify user exists
    const user = await this.userRepo.getUserById(userId);
    if (!user) {
      throw new NotFoundError(`User not found: ${userId}`);
    }

    return this.conversationRepo.getConversationsForUser(
      userId,
      limit,
      lastEvaluatedKey
    );
  }

  /**
   * Get a conversation by ID with access control
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

    // Check if user is a participant in this conversation
    if (!conversation.participants.includes(userId)) {
      throw new Error("User is not a participant in this conversation");
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
    // Get conversation and verify sender is a participant
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    if (!conversation.participants.includes(senderId)) {
      throw new Error("User is not a participant in this conversation");
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
    // Get conversation and verify user is a participant
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    if (!conversation.participants.includes(userId)) {
      throw new Error("User is not a participant in this conversation");
    }

    // Mark conversation as read for this user
    await this.conversationRepo.markAsRead(conversationId, userId);

    // Get messages
    return this.messageRepo.getMessagesForConversation(
      conversationId,
      limit,
      lastEvaluatedKey
    );
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
    // Get conversation and verify user is a participant
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    if (!conversation.participants.includes(userId)) {
      throw new Error("User is not a participant in this conversation");
    }

    // Mark conversation as read
    await this.conversationRepo.markAsRead(conversationId, userId);

    // Mark individual messages as read
    await this.messageRepo.batchUpdateMessageStatus(
      messageIds.map((messageId) => ({ messageId, conversationId })),
      userId,
      "READ"
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
    // Verify user exists
    const user = await this.userRepo.getUserById(userId);
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
