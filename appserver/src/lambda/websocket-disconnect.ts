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

const connectionRepo = new DynamoDBConnectionRepository(documentClient);
const userRepo = new UserRepository(prisma);
const connectionHandler = new WebSocketConnectionHandler(connectionRepo, userRepo);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    return await connectionHandler.handleDisconnect(event);
};
