// src/services/email/index.ts";

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses"
export class EmailService {
  private readonly sesClient: SESClient;
  private readonly defaultFromAddress: string;
  private readonly defaultReplyToAddress: string;
  private readonly appUrl: string;

  constructor(options: {
    region?: string;
    fromAddress?: string;
    replyToAddress?: string;
    appUrl?: string;
  } = {}) {
    const region = options.region || process.env.SES_REGION || 'us-east-1';
    this.defaultFromAddress = options.fromAddress || process.env.SES_FROM_ADDRESS || 'no-reply@example.com';
    this.defaultReplyToAddress = options.replyToAddress || process.env.SES_REPLY_TO_ADDRESS || this.defaultFromAddress;
    this.appUrl = options.appUrl || process.env.APP_URL || 'https://app.stagely.com';

    this.sesClient = new SESClient({ region });
  }

  /**
   * Send an invitation email
   * @param email The recipient's email address
   * @param token The invitation token
   * @param inviterName The name of the person who sent the invitation
   * @returns The message ID
   */
  async sendInvitationEmail(email: string, token: string, inviterName?: string): Promise<string> {
    const params = {
      Source: this.defaultFromAddress,
      Destination: {
        ToAddresses: [email]
      },
      Message: {
        Subject: {
          Data: `${inviterName || 'Someone'} invited you to Stagely`,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: `
              <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #042C44;">You've been invited to Stagely</h2>
                    <p>Hello,</p>
                    <p>You've been invited to join Stagely by ${inviterName || 'someone'}.</p>
                    <p>Stagely is a platform for managing properties and maintenance efficiently.</p>
                    <p style="margin: 30px 0;">

                        href="${this.appUrl}/accept-invitation?token=${token}"
                        style="background-color: #042C44; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;"
                      >
                        Accept Invitation
                      </a>
                    </p>
                    <p>This invitation link will expire in 7 days.</p>
                    <p>If you have any questions, please contact support.</p>
                    <p>Best regards,</p>
                    <p>The Stagely Team</p>
                  </div>
                </body>
              </html>
            `,
            Charset: 'UTF-8'
          },
          Text: {
            Data: `
              Hello,

              You've been invited to join Stagely by ${inviterName || 'someone'}.

              Stagely is a platform for managing properties and maintenance efficiently.

              Accept your invitation by visiting this link:
              ${this.appUrl}/accept-invitation?token=${token}

              This invitation link will expire in 7 days.

              If you have any questions, please contact support.

              Best regards,
              The Stagely Team
            `,
            Charset: 'UTF-8'
          }
        }
      },
      ReplyToAddresses: [this.defaultReplyToAddress]
    };

    try {
      const command = new SendEmailCommand(params);
      const response = await this.sesClient.send(command);
      return response.MessageId || '';
    } catch (error) {
      console.error('Error sending invitation email:', error);
      throw error;
    }
  }
}
