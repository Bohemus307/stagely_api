import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBConnectionRepository } from '../../repositories/dynamoDB/connectionRepository';
import { UserRepository } from '../../repositories/userRepository';
import jwt from 'jsonwebtoken';

export class WebSocketConnectionHandler {
    private readonly connectionRepo: DynamoDBConnectionRepository;
    private readonly userRepo: UserRepository;

    constructor(
        connectionRepo: DynamoDBConnectionRepository,
        userRepo: UserRepository
    ) {
        this.connectionRepo = connectionRepo;
        this.userRepo = userRepo;
    }

     /**
     * Handle WebSocket connection
     */
    async handleConnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        try {
            const connectionId = event.requestContext.connectionId!;
            const { userId, deviceId } = this.extractConnectionInfo(event);

            // Validate user exists
            await this.userRepo.getUserById(userId);

            // Store connection
            await this.connectionRepo.saveConnection(connectionId, userId, deviceId);

            console.log(`WebSocket connected: ${connectionId} for user ${userId}`);

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Connected successfully' })
            };
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Connection failed' })
            };
        }
    }

    /**
     * Handle WebSocket disconnection
     */
    async handleDisconnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        try {
            const connectionId = event.requestContext.connectionId!;

            // Remove connection
            await this.connectionRepo.deleteConnection(connectionId);

            console.log(`WebSocket disconnected: ${connectionId}`);

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Disconnected successfully' })
            };
        } catch (error) {
            console.error('WebSocket disconnection failed:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Disconnection failed' })
            };
        }
    }

    /**
     * Handle WebSocket messages (ping/pong, etc.)
     */
    async handleMessage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        try {
            const connectionId = event.requestContext.connectionId!;
            const body = JSON.parse(event.body || '{}');

            // Handle ping/pong for keepalive
            if (body.type === 'ping') {
                return {
                    statusCode: 200,
                    body: JSON.stringify({ type: 'pong', timestamp: Date.now() })
                };
            }

            // Handle other message types as needed
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Message received' })
            };
        } catch (error) {
            console.error('WebSocket message handling failed:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Message handling failed' })
            };
        }
    }

    /**
     * Extract user info from connection event
     */
    private extractConnectionInfo(event: APIGatewayProxyEvent): { userId: number; deviceId?: string } {
        // Get auth token from query parameters or headers
        const token = event.queryStringParameters?.token ||
                     event.headers?.Authorization?.replace('Bearer ', '');

        if (!token) {
            throw new Error('No auth token provided');
        }

        // Decode JWT token to get user info
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.sub) {
            throw new Error('Invalid auth token');
        }

        // Extract device ID from query parameters
        const deviceId = event.queryStringParameters?.deviceId;

        return {
            userId: parseInt(decoded.sub),
            deviceId
        };
    }
}
