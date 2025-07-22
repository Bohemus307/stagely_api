import { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBStreamProcessor } from '../services/websocket/DynamoDBStreamProcessor';
import { WebSocketBroadcastService } from '../services/websocket/WebSocketBroadcastService';
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

const apiGatewayEndpoint = process.env.WEBSOCKET_API_ENDPOINT!;
const broadcastService = new WebSocketBroadcastService(connectionRepo, userRepo, apiGatewayEndpoint);
const streamProcessor = new DynamoDBStreamProcessor(broadcastService);

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
    await streamProcessor.processStreamEvent(event);
};
