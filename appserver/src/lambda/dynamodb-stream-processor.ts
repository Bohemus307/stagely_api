// appserver/src/lambda/dynamodb-stream-processor.ts
import { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PrismaClient } from '@prisma/client';
import { DynamoDBConnectionRepository } from '../repositories/dynamoDB/connectionRepository';
import { UserRepository } from '../repositories/userRepository';
import { WebSocketBroadcastService } from '../services/websocket/WebSocketBroadcastService';
import { DynamoDBStreamProcessor } from '../services/websocket/DynamoDBStreamProcessor';

// Initialize clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const prisma = new PrismaClient();

// Initialize repositories
const deploymentEnv = process.env.NODE_ENV || 'staging';
const connectionRepo = new DynamoDBConnectionRepository(documentClient, process.env.NODE_ENV || 'staging');
const userRepo = new UserRepository(prisma);

// Initialize services
const webSocketEndpoint = process.env.WEBSOCKET_API_ENDPOINT;
if (!webSocketEndpoint) {
  throw new Error('WEBSOCKET_API_ENDPOINT environment variable is required');
}
const broadcastService = new WebSocketBroadcastService(connectionRepo, userRepo, webSocketEndpoint);
const streamProcessor = new DynamoDBStreamProcessor(broadcastService);

/**
 * AWS Lambda handler for DynamoDB Stream events
 * Processes events and broadcasts WebSocket messages
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  console.log(`Processing DynamoDB Stream with ${event.Records.length} records`);

  // Log the stream event for debugging
  console.log('Stream event details:', JSON.stringify({
    recordCount: event.Records.length,
    records: event.Records.map(record => ({
      eventName: record.eventName,
      eventSource: record.eventSource,
      eventSourceARN: record.eventSourceARN,
      dynamodb: {
        approximateCreationDateTime: record.dynamodb?.ApproximateCreationDateTime,
        keys: record.dynamodb?.Keys,
        streamViewType: record.dynamodb?.StreamViewType
      }
    }))
  }, null, 2));

  try {
    // Process the stream event
    await streamProcessor.processStreamEvent(event);

    console.log(`Successfully processed ${event.Records.length} stream records`);
  } catch (error) {
    console.error('Stream processing error:', error);

    // Log detailed error information
    console.error('Error details:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      eventRecordCount: event.Records.length,
      webSocketEndpoint,
      environment: deploymentEnv
    });

    // Re-throw to trigger Lambda retry mechanism
    throw error;
  } finally {
    // Ensure database connections are closed
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error('Error disconnecting from database:', disconnectError);
    }
  }
};
