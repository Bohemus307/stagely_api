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
import { v4 as uuidv4 } from "uuid";

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
      deploymentEnv,
    );
    this.messageRepo = new DynamoDBMessageRepository(
      documentClient,
      deploymentEnv,
    );
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
    initialMessage?: string,
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
      conversationType: "general",
    });

    // Send initial message if provided
    let message;
    if (initialMessage) {
      message = await this.sendMessage(
        conversation.conversationId,
        creatorId,
        initialMessage,
      );
    }

    return {
      conversation,
      message,
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
    lastEvaluatedKey?: any,
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
      lastEvaluatedKey,
    );
  }

  /**
   * Get a conversation by ID with access control
   * @param conversationId - The conversation ID
   * @param userId - The requesting user's ID (for permission check)
   */
  async getConversationById(
    conversationId: string,
    userId: number,
  ): Promise<DynamoDBConversation> {
    const conversation =
      await this.conversationRepo.getConversationById(conversationId);

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
    text: string,
  ): Promise<DynamoDBMessage> {
    // Get conversation and verify sender is a participant
    const conversation =
      await this.conversationRepo.getConversationById(conversationId);
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
      conversation.participants,
    );

    // Update conversation with new message info
    await this.conversationRepo.updateWithNewMessage(
      conversationId,
      senderId,
      text,
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
    lastEvaluatedKey?: any,
  ): Promise<{
    messages: DynamoDBMessage[];
    lastEvaluatedKey?: any;
  }> {
    // Get conversation and verify user is a participant
    const conversation =
      await this.conversationRepo.getConversationById(conversationId);
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
      lastEvaluatedKey,
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
    messageIds: string[],
  ): Promise<void> {
    // Get conversation and verify user is a participant
    const conversation =
      await this.conversationRepo.getConversationById(conversationId);
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
      "READ",
    );
  }

  /**
   * Invite a user and create/find conversation
   * This handles the complete flow: checking users, creating placeholders, sending emails, and managing conversations
   * @param currentUserId - ID of the user sending the invitation
   * @param email - Email address to invite
   * @param initialMessage - Optional initial message
   * @param emailService - Email service for sending invitations
   */
  async inviteAndCreateConversation(
    currentUserId: number,
    email: string,
    initialMessage?: string,
    emailService?: any,
  ): Promise<{
    conversation: DynamoDBConversation;
    message?: DynamoDBMessage;
    user: {
      id: number;
      email: string;
      isPlaceholder: boolean;
    };
    isNewInvitation: boolean;
    isExistingUser: boolean;
    isAlreadyInvited: boolean;
  }> {
    // Get the current user for email sending
    const currentUser = await this.userRepo.getUserById(currentUserId);
    if (!currentUser) {
      throw new Error(`Current user not found: ${currentUserId}`);
    }

    let user: any = null;
    let invitationToken: string | null = null;
    let isNewInvitation = false;
    let isExistingUser = false;
    let isAlreadyInvited = false;

    // Check if this is an active (non-placeholder) user
    user = await this.userRepo.findActiveUserByEmail(email);

    if (user) {
      // User is already active
      console.log("Found active user:", {
        userId: user.id,
        email: user.email,
      });
      isExistingUser = true;
    } else {
      // Check for existing invitation (placeholder user)
      user = await this.userRepo.findValidInvitationByEmail(email);

      if (user) {
        // Placeholder already exists
        console.log("Found existing invitation:", {
          userId: user.id,
          email: user.email,
          token: user.invitationToken?.substring(0, 8),
        });
        isAlreadyInvited = true;
        isNewInvitation = false; // Do NOT send email again
      } else {
        // Create new invitation
        invitationToken = uuidv4();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        user = await this.userRepo.createPlaceholderUser({
          email,
          invitationToken,
          invitedById: currentUserId,
          expiresAt,
        });

        isNewInvitation = true;

        // Send invitation email
        if (emailService) {
          try {
            await emailService.sendInvitationEmail(
              email,
              invitationToken,
              `${currentUser.firstName} ${currentUser.lastName}`,
            );
          } catch (error: any) {
            console.error("Failed to send invitation email:", {
              error: error.message,
              code: error.code,
              email,
            });
            // Continue even if email fails
          }
        }
      }
    }

    //  Find or create conversation
    let conversation: DynamoDBConversation;

    // Try to find existing conversation between these two users
    const existingConversation =
      await this.conversationRepo.findConversationByParticipants([
        currentUserId,
        user.id,
      ]);

    if (existingConversation) {
      conversation = existingConversation;
    } else {
      const result = await this.createConversation(currentUserId, [user.id]);
      conversation = result.conversation;
    }

    // Send initial message if provided
    let message: DynamoDBMessage | undefined;
    if (initialMessage) {
      message = await this.sendMessage(
        conversation.conversationId,
        currentUserId,
        initialMessage,
      );
    }

    return {
      conversation,
      message,
      user: {
        id: user.id,
        email: user.email,
        isPlaceholder: !!user.isPlaceholder,
      },
      isNewInvitation,
      isExistingUser,
      isAlreadyInvited,
    };
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
    const result = await this.conversationRepo.getConversationsForUser(
      userId,
      100,
    );

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
      conversationsWithUnread,
    };
  }
}
