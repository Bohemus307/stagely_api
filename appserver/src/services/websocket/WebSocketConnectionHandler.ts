import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBConnectionRepository } from '../../repositories/dynamoDB/connectionRepository';
import { UserRepository } from '../../repositories/userRepository';
import { Auth0TokenValidator } from './Auth0TokenValidator';

export class WebSocketConnectionHandler {
    private readonly connectionRepo: DynamoDBConnectionRepository;
    private readonly userRepo: UserRepository;
    private readonly auth0Validator: Auth0TokenValidator;

    constructor(
        connectionRepo: DynamoDBConnectionRepository,
        userRepo: UserRepository,
        auth0Domain: string
    ) {
        this.connectionRepo = connectionRepo;
        this.userRepo = userRepo;
        this.auth0Validator = new Auth0TokenValidator(auth0Domain);
    }

     /**
     * Handle WebSocket connection
     */
    async handleConnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        try {
            const connectionId = event.requestContext.connectionId!;

            // Extract Auth0 token from query parameters
            const token = event.queryStringParameters?.token;
            if (!token) {
                return { statusCode: 401, body: 'No token provided' };
            }

            // Validate token using Auth0's public key (no secret needed!)
            const { email, auth0Id } = await this.auth0Validator.validateToken(token);

            // Verify user exists in your database
            const user = await this.userRepo.getUserByAuth0Id(auth0Id);
            if (!user) {
                return { statusCode: 401, body: 'User not found' };
            }

            // Store connection
            const deviceId = event.queryStringParameters?.deviceId;
            await this.connectionRepo.saveConnection(connectionId, user.id, deviceId);

            console.log(`WebSocket connected: ${connectionId} for user ${user.id}`);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Connected successfully',
                    userId: user.id,
                    connectionId,
                    timestamp: Date.now()
                })
            };
        } catch (error) {
            console.error('WebSocket connection failed:', error);

            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: 'Authentication failed',
                    message: error instanceof Error ? error.message : 'Unknown authentication error',
                    timestamp: Date.now()
                })
            };
        }
    }

    /**
     * Handle WebSocket disconnection
     */
    async handleDisconnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
        try {
            const connectionId = event.requestContext.connectionId!;

            const connection = await this.connectionRepo.getConnection(connectionId);

            // Remove connection
            await this.connectionRepo.deleteConnection(connectionId);

            console.log(`WebSocket disconnected: ${connectionId}${connection ? ` (user ${connection.userId})` : ''}`);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Disconnected successfully',
                    connectionId,
                    userId: connection?.userId,
                    timestamp: Date.now()
                })
            };
        } catch (error) {
            console.error('WebSocket disconnection failed:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'Disconnection failed',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    timestamp: Date.now()
                })
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

            const connection = await this.connectionRepo.getConnection(connectionId);
            if (!connection) {
                console.log(`Message from unknown connection: ${connectionId}`);
                return {
                    statusCode: 404,
                    body: JSON.stringify({
                        error: 'Connection not found',
                        timestamp: Date.now()
                    })
                };
            }

            console.log(`WebSocket message received from ${connectionId}:`, body.type);

            // Handle ping/pong for keepalive
            if (body.type === 'ping') {
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        type: 'pong',
                        timestamp: Date.now(),
                        connectionId,
                        userId: connection.userId
                    })
                };
            }

            // Handle subscription requests
            if (body.type === 'subscribe') {
                // Handle subscription to specific events or entities
                console.log(`Subscription request from ${connectionId} (user ${connection.userId}):`, body.data);
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        type: 'subscription_ack',
                        data: body.data,
                        timestamp: Date.now(),
                        userId: connection.userId
                    })
                };
            }

            // Handle other message types as needed
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Message received',
                    type: body.type,
                    timestamp: Date.now(),
                    userId: connection.userId
                })
            };
        } catch (error) {
            console.error('WebSocket message handling failed:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'Message handling failed',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    timestamp: Date.now()
                })
            };
        }
    }


}

