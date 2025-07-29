// src/services/websocket/DynamoDBStreamProcessor.ts
import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { WebSocketBroadcastService, WebSocketMessage } from './WebSocketBroadcastService';
import { DynamoDBEvent, EventType } from '../../repositories/dynamoDB/eventsRepository';

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

        const processPromises = event.Records.map(record => this.processRecord(record));

        // Process records in parallel but collect results
        const results = await Promise.allSettled(processPromises);

        // Log any failures
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`Failed to process record ${index}:`, result.reason);
            }
        });

        // Count successful vs failed processing
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`Stream processing complete: ${successful} successful, ${failed} failed`);
    }

    /**
     * Process individual DynamoDB stream record
     */
    private async processRecord(record: DynamoDBRecord): Promise<void> {
        try {
            // Only process INSERT events (new events created)
            if (record.eventName !== 'INSERT') {
                console.log(`Skipping ${record.eventName} event - only processing INSERTs`);
                return;
            }

            if (!record.dynamodb?.NewImage) {
                console.log('No new image in record, skipping');
                return;
            }

            // Verify this is from the events table
            const sourceTable = this.extractTableName(record.eventSourceARN);
            if (!sourceTable || !sourceTable.includes('events')) {
                console.log(`Skipping record from table: ${sourceTable}`);
                return;
            }

            const eventData = unmarshall(record.dynamodb.NewImage as any) as DynamoDBEvent;

            console.log(`Processing event: ${eventData.eventType} for user ${eventData.userId}`, {
                eventId: eventData.eventId,
                category: eventData.category,
                timestamp: eventData.timestamp
            });

            // Convert to WebSocket message
            const message = this.broadcastService.transformEventToWebSocketMessage(eventData);

            // Determine broadcast strategy based on event type
            await this.broadcastEvent(eventData, message);

        } catch (error) {
            console.error('Error processing individual record:', error);
            throw error; // Re-throw to be caught by the outer handler
        }
    }

    /**
     * Extract table name from DynamoDB stream ARN
     */
    private extractTableName(arn?: string): string | null {
        if (!arn) return null;

        // ARN format: arn:aws:dynamodb:region:account:table/table-name/stream/timestamp
        const match = arn.match(/table\/([^\/]+)/);
        return match ? match[1] : null;
    }

    /**
     * Broadcast event based on type and scope (Updated with current event types)
     */
    private async broadcastEvent(event: DynamoDBEvent, message: WebSocketMessage): Promise<void> {
        try {
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
                    console.log(`Broadcasting user-specific event to user ${event.userId}`);
                    await this.broadcastService.broadcastToUser(event.userId, message);
                    break;

                // Media upload events - broadcast to user
                case EventType.INCIDENT_IMAGE_UPLOADED:
                case EventType.INSPECTION_PHOTO_UPLOADED:
                case EventType.INSPECTION_BULK_PHOTOS_UPLOADED:
                    console.log(`Broadcasting media upload event to user ${event.userId}`);
                    await this.broadcastService.broadcastToUser(event.userId, message);
                    break;

                default:
                    // Default: broadcast to event creator
                    console.log(`Broadcasting default event to user ${event.userId}`);
                    await this.broadcastService.broadcastToUser(event.userId, message);
            }

            console.log(`Successfully broadcasted ${event.eventType} event`);

        } catch (broadcastError) {
            console.error(`Failed to broadcast event ${event.eventId}:`, broadcastError);
            // Don't re-throw here - we want to continue processing other events
            // The error is logged for monitoring purposes
        }
    }

    /**
     * Handle special broadcast scenarios (for future expansion)
     */
    private async broadcastToMultipleUsers(event: DynamoDBEvent, message: WebSocketMessage, userIds: number[]): Promise<void> {
        console.log(`Broadcasting to ${userIds.length} users for event ${event.eventType}`);

        try {
            await this.broadcastService.broadcastToUsers(userIds, message);
            console.log(`Successfully broadcasted to ${userIds.length} users`);
        } catch (error) {
            console.error(`Failed to broadcast to multiple users:`, error);
            // Log the specific users that failed
            console.error('Failed user IDs:', userIds);
        }
    }

    /**
     * Get users to notify based on event context (for future expansion)
     * This could be used for property-wide notifications, team notifications, etc.
     */
    private async getUsersToNotify(event: DynamoDBEvent): Promise<number[]> {
        // For now, just return the event creator
        // In the future, this could query for:
        // - Property managers/owners for property events
        // - Team members for incident events
        // - Inspectors for inspection events

        const usersToNotify: number[] = [event.userId];

        // Example future logic:
        // if (event.eventType === EventType.INCIDENT_STATUS_CHANGED && event.relatedEntityId) {
        //   const propertyUsers = await this.getPropertyUsers(event.relatedEntityId);
        //   usersToNotify.push(...propertyUsers);
        // }

        return [...new Set(usersToNotify)]; // Remove duplicates
    }
}
