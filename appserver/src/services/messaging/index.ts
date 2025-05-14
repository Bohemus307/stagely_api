// src/services/messaging/messagingService.ts
import { PrismaClient } from "@prisma/client";
import { DynamoDBConversationRepository, DynamoDBConversation } from "../../repositories/dynamoDB/conversationRepository";
import { DynamoDBMessageRepository, DynamoDBMessage } from "../../repositories/dynamoDB/messageRepository";
import { DynamoDBConnectionRepository } from "../../repositories/dynamoDB/connectionRepository";
import { NotFoundError } from "../../utils/errors";
import { UserRepository } from "../../repositories/userRepository";
import { v4 as uuidv4 } from 'uuid';

export class MessagingService {
  private readonly prisma: PrismaClient;
  private readonly documentClient: any;
  private readonly conversationRepo: DynamoDBConversationRepository;
  private readonly messageRepo: DynamoDBMessageRepository;
  private readonly connectionRepo: DynamoDBConnectionRepository;
  private readonly userRepo: UserRepository;

  constructor(prisma: PrismaClient, documentClient: any) {
    this.prisma = prisma;
    this.documentClient = documentClient;
    const deploymentEnv = process.env.DEPLOYMENT_ENV || 'staging';
    this.conversationRepo = new DynamoDBConversationRepository(documentClient, deploymentEnv);
    this.messageRepo = new DynamoDBMessageRepository(documentClient, deploymentEnv);
    this.connectionRepo = new DynamoDBConnectionRepository(documentClient, deploymentEnv);
    this.userRepo = new UserRepository(prisma);
  }

  // Add this new method at the top of your MessagingService class
/**
 * Handle user invitation and create conversation
 */
async inviteUserAndCreateConversation(
  currentUserId: number,
  email: string,
  initialMessage?: string
): Promise<{
  conversation: DynamoDBConversation;
  message?: DynamoDBMessage;
  user: {
    id: number;
    email: string;
    isPlaceholder: boolean;
  };
  invitationToken?: string;
}> {
  // Get current user using repository
  const currentUser = await this.userRepo.getUserById(currentUserId);
  if (!currentUser) {
    throw new Error("Current user not found");
  }

  // First check if user exists - using repository methods
  let user = await this.userRepo.findActiveUserByEmail(email);
  let invitationToken: string | undefined;

  if (!user) {
    // Check for existing invitation
    user = await this.userRepo.findValidInvitationByEmail(email);

    if (!user) {
      // Create new invitation token
      invitationToken = uuidv4();

      // Set expiration date to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create placeholder user
      user = await this.userRepo.createPlaceholderUser({
        email,
        invitationToken,
        invitedById: currentUserId,
        expiresAt
      });
    }
  }

  // Create conversation with the user
  const conversation = await this.createConversation(
    currentUserId,
    [user.id],
    'general'
  );

  // Send initial message if provided
  let message;
  if (initialMessage) {
    message = await this.sendMessage(
      conversation.conversationId,
      currentUserId,
      initialMessage
    );
  }

  return {
    conversation,
    message,
    user: {
      id: user.id,
      email: user.email,
      isPlaceholder: !!user.isPlaceholder
    },
    invitationToken
  };
}

  /**
 * Create a new conversation
 * @param creatorId - User ID of the conversation creator
 * @param participants - Array of participant user IDs
 */
async createConversation(
  creatorId: number,
  participants: number[],
  type: 'general' = 'general'
): Promise<DynamoDBConversation> {
  // Ensure creator is in the participants list
  if (!participants.includes(creatorId)) {
    participants.push(creatorId);
  }

  // For one-on-one conversations (most common case), optimize the query
  if (participants.length === 2 && participants[0] === creatorId) {
    // We only need to validate the other participant
    const otherUser = await this.userRepo.getUserById(participants[1]);
    if (!otherUser) {
      throw new Error(`Participant with ID ${participants[1]} does not exist`);
    }
  } else if (participants.length === 2 && participants[1] === creatorId) {
    // We only need to validate the other participant
    const otherUser = await this.userRepo.getUserById(participants[0]);
    if (!otherUser) {
      throw new Error(`Participant with ID ${participants[0]} does not exist`);
    }
  } else {
    // For group conversations, validate all participants at once
    const validUsers = await this.userRepo.getUsersByIds(participants);

    // Check if all participants exist
    if (validUsers.length !== participants.length) {
      // Find which participants don't exist for better error message
      const foundIds = validUsers.map(user => user.id);
      const missingIds = participants.filter(id => !foundIds.includes(id));
      throw new Error(`Participants not found: ${missingIds.join(', ')}`);
    }
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
    text: string,
    fastify?: any
  ): Promise<DynamoDBMessage> {
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

    if (fastify && fastify.email) {
      // Get sender info using repository
      const sender = await this.userRepo.getUserById(senderId);
      const senderName = sender ? `${sender.firstName} ${sender.lastName}` : "A user";

      // Get all participants except sender - using repository
      const participantIds = conversation.participants.filter(id => id !== senderId);
      const recipientPromises = participantIds.map(id => this.userRepo.getUserById(id));
      const recipients = (await Promise.all(recipientPromises)).filter(Boolean);

      // Send email notification to all participants
      for (const recipient of recipients) {
        try {
          await fastify.email.sendMessageNotification({
            to: recipient.email,
            senderName,
            messageText: text,
            sentAt: new Date().toLocaleString(),
            conversationId
          });

          fastify.log.info(`Message notification sent to ${recipient.email}`);
        } catch (error) {
          fastify.log.error(`Failed to send message notification: ${error}`);
        }
      }
    }
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
    // User verification removed

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
    // Check if the participant exists - using repository
    const participant = await this.userRepo.getUserById(participantId);
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
    // Check if participant exists - using repository
    const participant = await this.userRepo.getUserById(participantId);
    if (!participant) {
      throw new NotFoundError(`Participant not found: ${participantId}`);
    }

    // Get conversation
    const conversation = await this.conversationRepo.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    // Check if requester has permission to remove participants
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
