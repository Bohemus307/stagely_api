// src/services/auth0.ts
import { ManagementClient } from 'auth0';

export class Auth0Service {
  private management: ManagementClient;

  constructor() {

    if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_MANAGEMENT_CLIENT_ID || !process.env.AUTH0_MANAGEMENT_CLIENT_SECRET) {
      throw new Error('Auth0 Management API credentials are required');
    }

    this.management = new ManagementClient({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
      clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,

    });
  }

  async deleteUser(auth0Id: string): Promise<void> {
    try {
      await this.management.users.delete({ id: auth0Id });
      console.log(`Successfully deleted user ${auth0Id} from Auth0`);
    } catch (error) {
      console.error(`Failed to delete user ${auth0Id} from Auth0:`, error);
      throw error;
    }
  }
}
