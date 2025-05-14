// src/plugins/emailPlugin.ts
import fp from "fastify-plugin";
import { EmailService } from "../services/email";

interface EmailPluginOptions {
  region?: string;
  fromAddress?: string;
  replyToAddress?: string;
  appUrl?: string;
}

export default fp(async (fastify, options: EmailPluginOptions = {}) => {
  const emailService = new EmailService(options);

  // Decorate fastify instance with email service
  fastify.decorate('email', {
    service: emailService,
    sendInvitationEmail: (email: string, token: string, inviterName: string) => {
      return emailService.sendInvitationEmail(email, token, inviterName);
    }
  });

  fastify.log.info('Email service initialized');
}, {
  name: 'email',
  fastify: '5.x'
});
