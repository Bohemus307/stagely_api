import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { WebSocketBroadcastService, WebSocketMessage } from './WebSocketBroadcastService';
import { DynamoDBEvent } from '../../repositories/dynamoDB/eventsRepository';

export class DynamoDBStreamProcessor {
    private readonly broadcastService: WebSocketBroadcastService;

    constructor(broadcastService: WebSocketBroadcastService) {
        this.broadcastService = broadcastService;
    }

    /**
     * Process DynamoDB stream events and broadcast to WebSocket clients
     */
    async processStreamEvent(event: DynamoDBStreamEvent): Promise<void> {
        console.log(`Processing ${event.Records.length} stream records`);

        for (const record of event.Records) {
            try {
                await this.processRecord(record);
            } catch (error) {
                console.error('Error processing stream record:', error);
                // Continue processing other records
            }
        }
    }

    /**
     * Process individual DynamoDB stream record
     */
    private async processRecord(record: DynamoDBRecord): Promise<void> {
        // Only process INSERT events (new events created)
        if (record.eventName !== 'INSERT') {
            return;
        }

        if (!record.dynamodb?.NewImage) {
            console.log('No new image in record, skipping');
            return;
        }

        // Unmarshal DynamoDB record to DynamoDBEvent
        const eventData = unmarshall(record.dynamodb.NewImage) as DynamoDBEvent;

        console.log(`Processing event: ${eventData.eventType} for user ${eventData.userId}`);

        // Convert to WebSocket message
        const message = this.broadcastService.transformEventToWebSocketMessage(eventData);

        // Determine broadcast strategy based on event type
        await this.broadcastEvent(eventData, message);
    }

    /**
     * Broadcast event based on type and scope (Updated with current event types)
     */
    private async broadcastEvent(event: DynamoDBEvent, message: WebSocketMessage): Promise<void> {
        switch (event.eventType) {
            // User-specific events - broadcast only to that user
            case EventType.PROPERTY_VIEWED:
            case EventType.INCIDENT_VIEWED:
            case EventType.INSPECTION_VIEWED:
            case EventType.PROPERTY_UPDATED:
            case EventType.INCIDENT_UPDATED:
            case EventType.INSPECTION_UPDATED:
            case EventType.INCIDENT_STATUS_CHANGED:
            case EventType.INCIDENT_SEVERITY_CHANGED:
            case EventType.INSPECTION_COMPLETED:
            case EventType.PROPERTY_STATUS_CHANGED:
            case EventType.PROPERTY_STATS_VIEWED:
                await this.broadcastService.broadcastToUser(event.userId, message);
                break;

            // Media upload events - broadcast to user
            case EventType.INCIDENT_IMAGE_UPLOADED:
            case EventType.INSPECTION_PHOTO_UPLOADED:
            case EventType.INSPECTION_BULK_PHOTOS_UPLOADED:
                await this.broadcastService.broadcastToUser(event.userId, message);
                break;

            default:
                // Default: broadcast to event creator
                await this.broadcastService.broadcastToUser(event.userId, message);
        }
    }

    /**
     * Handle messaging events that need to go to multiple users (Removed - no messaging events in current system)
     */
    private async broadcastMessagingEvent(event: DynamoDBEvent, message: WebSocketMessage): Promise<void> {
        // No messaging events in current simplified event system
        // Just broadcast to the event creator
        await this.broadcastService.broadcastToUser(event.userId, message);
    }
}
