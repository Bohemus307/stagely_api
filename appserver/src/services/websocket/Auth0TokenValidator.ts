// src/services/websocket/Auth0TokenValidator.ts
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export class Auth0TokenValidator {
    private jwksClient: jwksClient.JwksClient;

    constructor(auth0Domain: string) {
        this.jwksClient = jwksClient({
            jwksUri: `https://${auth0Domain}/.well-known/jwks.json`,
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 5,
        });
    }

    /**
     * Validate Auth0 token using Auth0's public key
     */
    async validateToken(token: string): Promise<{ auth0Id: string; email?: string }> {
        try {
            // Decode token header to get key ID
            const decoded = jwt.decode(token, { complete: true });
            if (!decoded || !decoded.header.kid) {
                throw new Error('Invalid token format - missing kid');
            }

            // Get Auth0's public key
            const key = await this.getSigningKey(decoded.header.kid);

            // Verify token with Auth0's public key
            const payload = jwt.verify(token, key) as any;

            // Validate required fields
            if (!payload.sub) {
                throw new Error('Token missing subject');
            }

            return {
                auth0Id: payload.sub, // This is a string like "auth0|65f7b8a9c123456789abcdef"
                email: payload.email
            };
        } catch (error) {
            console.error('Token validation failed:', error);
            throw new Error(`Token validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async getSigningKey(kid: string): Promise<string> {
        try {
            const key = await this.jwksClient.getSigningKey(kid);
            return key.getPublicKey();
        } catch (error) {
            console.error('Failed to get signing key:', error);
            throw new Error(`Failed to get signing key: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
