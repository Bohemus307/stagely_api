import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { EventService } from '../services/eventService';
import { DynamoDBEventRepository } from '../repositories/dynamoDB/eventsRepository';
import { UserRepository } from '../repositories/userRepository';

declare module 'fastify' {
    interface FastifyInstance {
        eventService: EventService;
        getEventMetadata: (request: FastifyRequest) => {
            ipAddress?: string;
            userAgent?: string;
            source: string;
            deviceId?: string;
            version?: string;
            performanceMetrics?: {
                duration?: number;
                memoryUsage?: number;
                queryCount?: number;
                cacheHit?: boolean;
            };
        };
        logCriticalEvent: (
            eventType: 'property_viewed' | 'incident_viewed' | 'inspection_viewed' | 'incident_status_changed' | 'incident_severity_changed' | 'inspection_completed',
            request: FastifyRequest,
            eventData: any
        ) => Promise<void>;
        logHighPriorityEvent: (
            eventType: 'user_login' | 'property_created' | 'incident_created' | 'message_sent' | 'conversation_created' | 'inspection_created',
            request: FastifyRequest,
            eventData: any
        ) => Promise<void>;
    }
}

async function eventServicePlugin(
    fastify: FastifyInstance,
    opts: FastifyPluginOptions
) {
    const userRepository = new UserRepository(fastify.prisma);
    const eventRepository = new DynamoDBEventRepository(
        fastify.dynamoDB.documentClient,
        process.env.NODE_ENV || 'staging'
    );

    const eventService = new EventService(eventRepository, userRepository);

    fastify.decorate('eventService', eventService);

    // Enhanced metadata extraction with performance tracking
    fastify.decorate('getEventMetadata', (request: any) => {
        const startTime = request.startTime || Date.now();
        const duration = Date.now() - startTime;

        return {
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            source: request.headers['x-app-source'] || 'api', // mobile, web, api
            deviceId: request.headers['x-device-id'] || undefined,
            version: request.headers['x-app-version'] || undefined,
            performanceMetrics: {
                duration,
                memoryUsage: process.memoryUsage().heapUsed,
                queryCount: request.queryCount || 0,
                cacheHit: request.cacheHit || false
            }
        };
    });

    // Critical Events
    fastify.decorate('logCriticalEvent', async (
        eventType: 'property_viewed' | 'incident_viewed' | 'inspection_viewed' | 'incident_status_changed' | 'incident_severity_changed' | 'inspection_completed',
        request: any,
        eventData: any
    ) => {
        if (!request.user?.id) return;

        const metadata = fastify.getEventMetadata(request);

        setImmediate(async () => {
        try {
            // Use specific performance event methods
            switch (eventType) {
                case 'property_viewed':
                    await eventService.logPropertyViewed(
                        request.user.id,
                        eventData.propertyId,
                        eventData.propertyAddress,
                        metadata
                    );
                    break;
                case 'incident_viewed':
                    await eventService.logIncidentViewed(
                        request.user.id,
                        eventData.incidentId,
                        eventData.propertyId,
                        eventData.incidentType,
                        metadata
                    );
                    break;
                case 'inspection_viewed':
                    await eventService.logInspectionViewed(
                        request.user.id,
                        eventData.inspectionId,
                        eventData.propertyId,
                        eventData.inspectionTitle,
                        metadata
                    );
                    break;

                case 'incident_status_changed':
                    await eventService.logIncidentStatusChanged(
                        request.user.id,
                        eventData.incidentId,
                        eventData.propertyId,
                        eventData.oldStatus,
                        eventData.newStatus,
                        metadata
                    );
                    break;

                case 'incident_severity_changed':
                    await eventService.logIncidentSeverityChanged(
                        request.user.id,
                        eventData.incidentId,
                        eventData.propertyId,
                        eventData.oldSeverity,
                        eventData.newSeverity,
                        metadata
                    );
                    break;

                case "inspection_completed":
                    await eventService.logInspectionCompleted(
                        request.user.id,
                        eventData.inspectionId,
                        eventData.propertyId,
                        eventData.inspectionTitle,
                        eventData.photoCount,
                        metadata
                    );
                    break;

            }
        } catch (error) {
            fastify.log.error(`Failed to log critical event ${eventType}:`, error);
        }
    });
    });

    //High Priority Events
    fastify.decorate('logHighPriorityEvent', async (
        eventType: 'user_login' | 'property_created' | 'incident_created' | 'message_sent' | 'conversation_created' | 'inspection_created',
        request: any,
        eventData: any
    ) => {
        if (!request.user?.id) return;

        const metadata = fastify.getEventMetadata(request);

        setImmediate(async () => {
            try {
                switch (eventType) {
                    case 'user_login':
                        await eventService.logUserLogin(
                            request.user.id,
                            eventData.email,
                            metadata
                        );
                        break;

                    case 'property_created':
                        await eventService.logPropertyCreated(
                            request.user.id,
                            eventData.propertyId,
                            eventData.propertyAddress,
                            eventData.propertyType,
                            metadata
                        );
                        break;

                    case 'incident_created':
                        await eventService.logIncidentCreated(
                            request.user.id,
                            eventData.incidentId,
                            eventData.propertyId,
                            eventData.incidentType,
                            eventData.severity,
                            metadata
                        );
                        break;

                    case 'message_sent':
                        await eventService.logMessageSent(
                            request.user.id,
                            eventData.messageId,
                            eventData.conversationId,
                            eventData.recipientCount,
                            eventData.textLength,
                            metadata
                        );
                        break;

                    case 'conversation_created':
                        await eventService.logConversationCreated(
                            request.user.id,
                            eventData.conversationId,
                            eventData.participantCount,
                            eventData.conversationType,
                            eventData.hasInitialMessage,
                            metadata
                        );
                        break;
                }
            } catch (error) {
                fastify.log.error(`Failed to log high priority event ${eventType}:`, error);
            }
        });
    });

    // Add request timing for performance metrics
    fastify.addHook('onRequest', async (request) => {
        (request as any).startTime = Date.now();
        (request as any).queryCount = 0;
        (request as any).cacheHit = false;
    });

    fastify.addHook('onError', async (request, reply, error) => {
        const statusCode = error.statusCode || 500;

        // Only log critical business errors (500+), not validation errors (400-499)
        if (request.user?.id && statusCode >= 500) {
            // Move to separate error logging service instead of events
            fastify.log.error(`Critical error for user ${request.user.id}:`, {
                error: error.message,
                endpoint: request.url,
                statusCode,
                userId: request.user.id,
                stack: error.stack
            });
        }
    });
}


export default fp(eventServicePlugin, {
    name: 'event-service',
    dependencies: ['prisma', 'dynamoDB']
});
