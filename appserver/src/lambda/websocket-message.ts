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
 * AWS Lambda handler for WebSocket messages
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket message event:', JSON.stringify(event, null, 2));

  try {
    const result = await connectionHandler.handleMessage(event);

    console.log('Message handled successfully:', {
      connectionId: event.requestContext.connectionId,
      routeKey: event.requestContext.routeKey,
      statusCode: result.statusCode
    });

    return result;
  } catch (error) {
    console.error('Message handler error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to process message',
        timestamp: Date.now()
      })
    };
  } finally {
    await prisma.$disconnect().catch(console.error);
  }
};
