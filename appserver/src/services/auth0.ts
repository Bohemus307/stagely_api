import axios from 'axios';

interface Auth0Token {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class Auth0Service {
  private baseURL: string;
  private clientId: string;
  private clientSecret: string;
  private domain: string;

  constructor() {
    if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_MANAGEMENT_CLIENT_ID || !process.env.AUTH0_MANAGEMENT_CLIENT_SECRET) {
      throw new Error('Auth0 Management API credentials are required');
    }

    this.domain = process.env.AUTH0_DOMAIN;
    this.baseURL = `https://${this.domain}`;
    this.clientId = process.env.AUTH0_MANAGEMENT_CLIENT_ID;
    this.clientSecret = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET;
  }

  /**
   * Get Management API access token
   */
  private async getManagementToken(): Promise<string> {
    try {
      const response = await axios.post(`${this.baseURL}/oauth/token`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        audience: `${this.baseURL}/api/v2/`,
        grant_type: 'client_credentials'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return (response.data as Auth0Token).access_token;
    } catch (error) {
      console.error('Failed to get Auth0 management token:', error);
      throw new Error('Failed to authenticate with Auth0 Management API');
    }
  }

  /**
   * Delete a user from Auth0
   */
  async deleteUser(auth0Id: string): Promise<void> {
    try {
      const token = await this.getManagementToken();

      await axios.delete(`${this.baseURL}/api/v2/users/${auth0Id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      console.log(`Successfully deleted user ${auth0Id} from Auth0`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.message || error.response?.statusText || error.message;
        console.error(`Failed to delete user ${auth0Id} from Auth0:`, errorMessage);
        throw new Error(`Auth0 deletion failed: ${errorMessage}`);
      } else {
        console.error(`Failed to delete user ${auth0Id} from Auth0:`, error);
        throw new Error('Unknown error deleting Auth0 user');
      }
    }
  }

  /**
   * Block a user in Auth0 (alternative to deletion)
   */
  async blockUser(auth0Id: string): Promise<void> {
    try {
      const token = await this.getManagementToken();

      await axios.patch(`${this.baseURL}/api/v2/users/${auth0Id}`, {
        blocked: true
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      console.log(`Successfully blocked user ${auth0Id} in Auth0`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.message || error.response?.statusText || error.message;
        throw new Error(`Auth0 blocking failed: ${errorMessage}`);
      } else {
        throw new Error('Unknown error blocking Auth0 user');
      }
    }
  }
}
