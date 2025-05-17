// src/services/invitation/index.ts
import { v4 as uuidv4 } from "uuid";
import { UserRepository } from "../../repositories/userRepository";
import { User } from "@prisma/client";

export class InvitationService {
  private userRepository: UserRepository;
  private emailSender: {
    sendInvitationEmail: (email: string, token: string, inviterName: string) => Promise<string>
  };

  constructor(
    userRepository: UserRepository,
    emailSender: {
      sendInvitationEmail: (email: string, token: string, inviterName: string) => Promise<string>
    }
  ) {
    this.userRepository = userRepository;
    this.emailSender = emailSender;
  }

  /**
   * Invite a user to the platform
   * @param email Email address to invite
   * @param inviterId ID of the user sending the invitation
   * @param inviterName Name of the inviter for the email
   */
  async inviteUser(email: string, inviterId: number, inviterName: string): Promise<{
    user: {
      id: number;
      email: string;
      isPlaceholder: boolean;
    },
    isNewInvitation: boolean
  }> {
    // Check if user already exists
    let user = await this.userRepository.findActiveUserByEmail(email);

    if (user) {
      // User already exists - return existing user
      return {
        user: {
          id: user.id,
          email: user.email,
          isPlaceholder: false
        },
        isNewInvitation: false
      };
    }

    // Check for existing invitation
    user = await this.userRepository.findValidInvitationByEmail(email);

    if (user) {
      // Invitation already exists - return the placeholder user
      return {
        user: {
          id: user.id,
          email: user.email,
          isPlaceholder: true
        },
        isNewInvitation: false
      };
    }

    // Create new invitation
    const invitationToken = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

    const newUser = await this.userRepository.createPlaceholderUser({
      email,
      invitationToken,
      invitedById: inviterId,
      expiresAt
    });

    // Send invitation email
    try {
      await this.emailSender.sendInvitationEmail(
        email,
        invitationToken,
        inviterName
      );
    } catch (error) {
      console.error("Failed to send invitation email:", error);
      // Continue even if email sending fails
    }

    return {
      user: {
        id: newUser.id,
        email: newUser.email,
        isPlaceholder: true
      },
      isNewInvitation: true
    };
  }

  /**
   * Accept a user invitation
   * @param token Invitation token
   * @param currentUser Current authenticated user
   */
  async acceptInvitation(token: string, currentUser: User): Promise<boolean> {
    // Find the placeholder user by token
    const placeholderUser = await this.userRepository.findByInvitationToken(token);

    if (!placeholderUser) {
      return false;
    }

    // Update the placeholder user with current user's details
    await this.userRepository.updateUser(placeholderUser.id, {
      firstName: currentUser.firstName,
      lastName: currentUser.lastName,
      profilePictureUrl: currentUser.profilePictureUrl,
      isPlaceholder: false,
      invitationToken: null,
      expiresAt: null
    });

    // Delete the current user since we're transferring identity
    // Only do this if the users are different
    if (currentUser.id !== placeholderUser.id) {
      await this.userRepository.deleteUser(currentUser.id);
    }

    return true;
  }

  /**
   * Check if an invitation token is valid
   * @param token Invitation token to check
   */
  async checkInvitation(token: string): Promise<{
    valid: boolean;
    email: string | null;
  }> {
    const placeholderUser = await this.userRepository.findByInvitationToken(token);

    return {
      valid: !!placeholderUser,
      email: placeholderUser?.email || null
    };
  }
}
