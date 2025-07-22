import { ApiGatewayManagementApi } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBConnectionRepository, DynamoDBConnection } from '../../repositories/dynamoDB/connectionRepository';
import { DynamoDBEvent, EventType } from '../../repositories/dynamoDB/eventsRepository';
import { UserRepository } from '../../repositories/userRepository';

export interface WebSocketMessage {
    type: 'event' | 'system' | 'prefetch' | 'ui_update' | 'progress';
    eventType?: EventType;
    priority: "critical" | 'high' | 'medium' | 'low';
    data: any;
    timestamp: number;
    userId: number;
}

export class WebSocketBroadcastService {
    private readonly connectionRepo: DynamoDBConnectionRepository;
    private readonly userRepo: UserRepository;
    private readonly apiGateway: ApiGatewayManagementApi;

    constructor(
        connectionRepo: DynamoDBConnectionRepository,
        userRepo: UserRepository,
        apiGatewayEndpoint: string
    ) {
        this.connectionRepo = connectionRepo;
        this.userRepo = userRepo;
        this.apiGateway = new ApiGatewayManagementApi({
            endpoint: apiGatewayEndpoint
        });
    }

    /**
     * Broadcast event to specific user's devices
     */
    async broadcastToUser(userId: number, message: WebSocketMessage): Promise<void> {
       const connections = await this.connectionRepo.getConnectionsForUser(userId);

       if (connections.length = 0) {
        console.log(`no active connections for user ${userId}`);
        return;
       }

       const broadcastPromises = connections.map(connection =>
        this.sendToConnection(connection.connectionId, message)
       );

       await Promise.all(broadcastPromises);
    }

    /**
     * Broadcast event to multiple users
     */
    async broadcastToUsers(userIds: number[], message: WebSocketMessage): Promise<void> {
        const broadcastPromises = userIds.map(userId =>
            this.broadcastToUser(userId, message)
        );

        await Promise.all(broadcastPromises);
    }

    /**
     * Send message to specific connection
     */
    private async sendToConnection(connectionId: string, message: WebSocketMessage): Promise<void> {
        try {
            await this.apiGateway.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify(message)
            });
        } catch (error: any) {
            console.error(`Failed to send message to connection ${connectionId}:`, error);

            // If connection is stale, remove it
            if (error.statusCode === 410) {
                await this.connectionRepo.deleteConnection(connectionId);
                console.log(`Removed stale connection: ${connectionId}`);
            }
        }
    }

    /**
     * Convert DynamoDB event to WebSocket message based on priority (Updated with current event types)
     */
    transformEventToWebSocketMessage(event: DynamoDBEvent): WebSocketMessage {
        const baseMessage: WebSocketMessage = {
            type: 'event',
            eventType: event.eventType,
            priority: this.getEventPriority(event.eventType),
            data: {
                eventId: event.eventId,
                eventType: event.eventType,
                category: event.category,
                title: event.title,
                description: event.description,
                payload: event.payload,
                timestamp: event.timestamp,
                relatedEntityId: event.relatedEntityId,
                relatedEntityType: event.relatedEntityType
            },
            timestamp: event.timestamp,
            userId: event.userId
        };

        // Add specific message types based on event
        switch (event.eventType) {
            case EventType.PROPERTY_VIEWED:
            case EventType.INCIDENT_VIEWED:
            case EventType.INSPECTION_VIEWED:
                return {
                    ...baseMessage,
                    type: 'prefetch',
                    data: {
                        ...baseMessage.data,
                        prefetchHints: event.payload.prefetchHints
                    }
                };

            case EventType.INCIDENT_STATUS_CHANGED:
            case EventType.INCIDENT_SEVERITY_CHANGED:
            case EventType.INSPECTION_COMPLETED:
                return {
                    ...baseMessage,
                    type: 'ui_update',
                    data: {
                        ...baseMessage.data,
                        uiUpdateHints: event.payload.uiUpdateHints
                    }
                };

            case EventType.INSPECTION_BULK_PHOTOS_UPLOADED:
                return {
                    ...baseMessage,
                    type: 'progress',
                    data: {
                        ...baseMessage.data,
                        progressHints: event.payload.progressHints
                    }
                };

            default:
                return baseMessage;
        }
    }

    /**
     * Get event priority for WebSocket delivery (Updated with current event types)
     */
    private getEventPriority(eventType: EventType): 'critical' | 'high' | 'medium' | 'low' {
        const criticalEvents: EventType[] = [
            EventType.PROPERTY_VIEWED,
            EventType.INCIDENT_VIEWED,
            EventType.INSPECTION_VIEWED,
            EventType.INCIDENT_STATUS_CHANGED,
            EventType.INCIDENT_SEVERITY_CHANGED,
            EventType.INSPECTION_COMPLETED
        ];

        const highEvents: EventType[] = [
            EventType.PROPERTY_STATUS_CHANGED,
            EventType.PROPERTY_STATS_VIEWED
        ];

        const mediumEvents: EventType[] = [
            EventType.PROPERTY_UPDATED,
            EventType.INCIDENT_UPDATED,
            EventType.INSPECTION_UPDATED,
            EventType.INCIDENT_IMAGE_UPLOADED,
            EventType.INSPECTION_PHOTO_UPLOADED,
            EventType.INSPECTION_BULK_PHOTOS_UPLOADED
        ];

        if (criticalEvents.includes(eventType)) return 'critical';
        if (highEvents.includes(eventType)) return 'high';
        if (mediumEvents.includes(eventType)) return 'medium';
        return 'low';
    }
}

