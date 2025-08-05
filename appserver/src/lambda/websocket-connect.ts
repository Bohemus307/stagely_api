import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBConnectionRepository } from '../repositories/dynamoDB/connectionRepository';
import { UserRepository } from '../repositories/userRepository';
import { WebSocketConnectionHandler } from '../services/websocket/WebSocketConnectionHandler';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PrismaClient } from '@prisma/client';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const prisma = new PrismaClient();

const deploymentEnv = process.env.NODE_ENV || 'staging';
const connectionRepo = new DynamoDBConnectionRepository(documentClient);
const userRepo = new UserRepository(prisma);

const auth0Domain = process.env.AUTH0_DOMAIN;
if (!auth0Domain) {
  throw new Error('AUTH0_DOMAIN environment variable is required');
}
const connectionHandler = new WebSocketConnectionHandler(connectionRepo, userRepo, auth0Domain);

/**
 * AWS Lambda handler for WebSocket connections
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket connect event:', JSON.stringify(event, null, 2));

  try {
    const result = await connectionHandler.handleConnect(event);

    console.log('Connection successful:', {
      connectionId: event.requestContext.connectionId,
      statusCode: result.statusCode
    });

    return result;
  } catch (error) {
    console.error('Connection handler error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to process connection',
        timestamp: Date.now()
      })
    };
  } finally {
    // Clean up database connections
    await prisma.$disconnect().catch(console.error);
  }
};

