import { WebSocketBroadcastService } from '../services/websocket/WebSocketBroadcastService';
import { EventService } from '../services/eventService';

export class WebSocketTester {
    private readonly broadcastService: WebSocketBroadcastService;
    private readonly eventService: EventService;

    constructor(broadcastService: WebSocketBroadcastService, eventService: EventService) {
        this.broadcastService = broadcastService;
        this.eventService = eventService;
    }

    /**
     * Test WebSocket broadcasting with a mock event
     */
    async testEventBroadcast(userId: number): Promise<void> {
        // Create a test event
        const event = await this.eventService.logPropertyViewed(
            userId,
            123,
            '123 Test Street',
            {
                source: 'test',
                deviceId: 'test-device',
                performanceMetrics: {
                    duration: 50,
                    memoryUsage: 1000000,
                    queryCount: 1,
                    cacheHit: false
                }
            }
        );

        // Convert to WebSocket message
        const message = this.broadcastService.transformEventToWebSocketMessage(event);

        // Broadcast to user
        await this.broadcastService.broadcastToUser(userId, message);

        console.log(`Test broadcast sent to user ${userId}:`, message);
    }
}
