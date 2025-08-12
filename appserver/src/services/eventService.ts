import { DynamoDBEventRepository, EventType, EventCategory, DynamoDBEvent, EventMetadata } from '../repositories/dynamoDB/eventsRepository';
import { UserRepository } from '../repositories/userRepository';
import { NotFoundError } from '../utils/errors';

export class EventService {
    private eventRepository: DynamoDBEventRepository;
    private userRepository: UserRepository;

    constructor(
        eventRepository: DynamoDBEventRepository,
        userRepository: UserRepository
    ) {
        this.eventRepository = eventRepository;
        this.userRepository = userRepository;
    }

    /**
     * Helper method to create events with proper categorization
     */
    private getCategoryForEventType(eventType: EventType): EventCategory {
        const categoryMap: Record<EventType, EventCategory> = {

            // Property events
            [EventType.PROPERTY_VIEWED]: EventCategory.PROPERTY,
            [EventType.PROPERTY_UPDATED]: EventCategory.PROPERTY,
            [EventType.PROPERTY_STATUS_CHANGED]: EventCategory.PROPERTY,
            [EventType.PROPERTY_STATS_VIEWED]: EventCategory.PROPERTY,

            // Incident events
            [EventType.INCIDENT_VIEWED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_UPDATED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_STATUS_CHANGED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_SEVERITY_CHANGED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_IMAGE_UPLOADED]: EventCategory.INCIDENT,

            // Inspection events
            [EventType.INSPECTION_COMPLETED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_VIEWED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_UPDATED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_PHOTO_UPLOADED]: EventCategory.INSPECTION,

        };

        return categoryMap[eventType];
    }

    /**
     * Create a new event
     */
    async createEvent(
        userId: number,
        eventType: EventType,
        title: string,
        description: string,
        payload: any,
        metadata?: EventMetadata,
        relatedEntityId?: string,
        relatedEntityType?: string
    ): Promise<DynamoDBEvent> {
        // Skip user validation for performance-critical events if needed
        const skipUserValidation = metadata?.source === 'mobile' || metadata?.performanceMetrics?.cacheHit;

        if (!skipUserValidation) {
            try {
                await this.userRepository.getUserById(userId);
            } catch (error) {
                throw new NotFoundError(`User with ID ${userId} not found`);
            }
        }

        const category = this.getCategoryForEventType(eventType);

        return await this.eventRepository.createEvent({
            userId,
            eventType,
            category,
            title,
            description,
            payload,
            metadata,
            relatedEntityId,
            relatedEntityType
        });
    }

    /**
     * Create multiple events in batch for performance
     */
    async createEventsBatch(
        events: Array<{
            userId: number;
            eventType: EventType;
            title: string;
            description: string;
            payload: any;
            metadata?: EventMetadata;
            relatedEntityId?: string;
            relatedEntityType?: string;
        }>
    ): Promise<DynamoDBEvent[]> {
        const eventsData = events.map(event => ({
            ...event,
            category: this.getCategoryForEventType(event.eventType)
        }));

        return await this.eventRepository.createEventsBatch(eventsData);
    }

    // ===========================================
    // PERFORMANCE CRITICAL EVENT METHODS
    // ===========================================

    /**
     * Log property viewed
     */
    async logPropertyViewed(
        userId: number,
        propertyId: number,
        propertyAddress: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_VIEWED,
            'Property Viewed',
            `Property ${propertyAddress} viewed`,
            {
                propertyId,
                propertyAddress,
                timestamp: new Date().toISOString(),

                prefetchHints: {
                    incidents: true,
                    inspections: true,
                    images: true,
                    stats: true
                }
            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }

    /**
     * Log incident viewed
     */
    async logIncidentViewed(
        userId: number,
        incidentId: number,
        propertyId: number,
        incidentType: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INCIDENT_VIEWED,
            'Incident Viewed',
            `${incidentType} incident viewed`,
            {
                incidentId,
                propertyId,
                incidentType,
                timestamp: new Date().toISOString(),

                prefetchHints: {
                    images: true,
                    relatedIncidents: true,
                    propertyDetails: true
                }
            },
            metadata,
            incidentId.toString(),
            'incident'
        );
    }

    /**
     * Log inspection viewed
     */
    async logInspectionViewed(
        userId: number,
        inspectionId: number,
        propertyId: number,
        inspectionTitle: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_VIEWED,
            'Inspection Viewed',
            `Inspection "${inspectionTitle}" viewed`,
            {
                inspectionId,
                propertyId,
                inspectionTitle,
                timestamp: new Date().toISOString(),

                prefetchHints: {
                    photos: true,
                    relatedInspections: true,
                    propertyDetails: true,
                    classificationResults: true
                }
            },
            metadata,
            inspectionId.toString(),
            'inspection'
        );
    }

    /**
     * Log incident status changed
     */
    async logIncidentStatusChanged(
        userId: number,
        incidentId: number,
        propertyId: number,
        oldStatus: string,
        newStatus: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INCIDENT_STATUS_CHANGED,
            'Incident Status Changed',
            `Incident status changed from ${oldStatus} to ${newStatus}`,
            {
                incidentId,
                propertyId,
                oldStatus,
                newStatus,
                timestamp: new Date().toISOString(),

                uiUpdateHints: {
                    refreshIncidentList: true,
                    updateIncidentDetail: true,
                    refreshPropertyStats: true
                }
            },
            metadata,
            incidentId.toString(),
            'incident'
        );
    }

    /**
     * Log incident severity changed
     */
    async logIncidentSeverityChanged(
        userId: number,
        incidentId: number,
        propertyId: number,
        oldSeverity: string,
        newSeverity: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INCIDENT_SEVERITY_CHANGED,
            'Incident Severity Changed',
            `Incident severity changed from ${oldSeverity} to ${newSeverity}`,
            {
                incidentId,
                propertyId,
                oldSeverity,
                newSeverity,
                timestamp: new Date().toISOString(),

                uiUpdateHints: {
                    refreshIncidentList: true,
                    updateIncidentDetail: true,
                    refreshPropertyStats: true,
                    priorityChanged: true
                }
            },
            metadata,
            incidentId.toString(),
            'incident'
        );
    }

    /**
     * Log inspection completed
     */
    async logInspectionCompleted(
        userId: number,
        inspectionId: number,
        propertyId: number,
        inspectionTitle: string,
        photoCount: number,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_COMPLETED,
            'Inspection Completed',
            `Inspection "${inspectionTitle}" completed with ${photoCount} photos`,
            {
                inspectionId,
                propertyId,
                inspectionTitle,
                photoCount,
                timestamp: new Date().toISOString(),

                syncHints: {
                    uploadPhotos: true,
                    processClassification: true,
                    updatePropertyStats: true
                }
            },
            metadata,
            inspectionId.toString(),
            'inspection'
        );
    }

    // ===========================================
    // HIGH PRIORITY EVENT METHODS
    // ===========================================

    /**
     * Log when a property is updated
     */
    async logPropertyUpdated(
        userId: number,
        propertyId: number,
        propertyAddress: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_UPDATED,
            'Property Updated',
            `Property "${propertyAddress}" was updated`,
            {
                propertyId,
                propertyAddress,
                timestamp: new Date().toISOString()

            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }

    /**
     * Log when an incident is updated
     */
    async logIncidentUpdated(
        userId: number,
        incidentId: number,
        propertyId: number,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INCIDENT_UPDATED,
            'Incident Updated',
            `Incident #${incidentId} was updated`,
            {
                incidentId,
                propertyId,
                timestamp: new Date().toISOString()

            },
            metadata,
            incidentId.toString(),
            'incident'
        );
    }

    /**
     * Log when an inspection is updated
     */
    async logInspectionUpdated(
        userId: number,
        inspectionId: number,
        propertyId: number,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_UPDATED,
            'Inspection Updated',
            `Inspection #${inspectionId} was updated`,
            {
                inspectionId,
                propertyId,
                timestamp: new Date().toISOString()

            },
            metadata,
            inspectionId.toString(),
            'inspection'
        );
    }

    // ===========================================
    // MEDIUM PRIORITY EVENTS
    // ===========================================

    /**
     * Log inspection photo uploaded
     */
    async logInspectionPhotoUploaded(
        userId: number,
        inspectionId: number,
        propertyId: number,
        imageUrl: string,
        spaceType?: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_PHOTO_UPLOADED,
            'Inspection Photo Uploaded',
            'Photo uploaded for inspection',
            {
                inspectionId,
                propertyId,
                imageUrl,
                spaceType,
                timestamp: new Date().toISOString(),

                processingHints: {
                    runClassification: true,
                    generateThumbnails: true,
                    updateInspectionDetail: true
                }
            },
            metadata,
            inspectionId.toString(),
            'inspection'
        );
    }

    /**
     * Log incident image uploaded
     */
    async logIncidentImageUploaded(
        userId: number,
        incidentId: number,
        propertyId: number,
        imageUrl: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INCIDENT_IMAGE_UPLOADED,
            'Incident Image Uploaded',
            'Image uploaded for incident',
            {
                incidentId,
                propertyId,
                imageUrl,
                timestamp: new Date().toISOString(),

                processingHints: {
                    runClassification: true,
                    generateThumbnails: true,
                    updateIncidentDetail: true
                }
            },
            metadata,
            incidentId.toString(),
            'incident'
        );
    }

    /**
     * Log property status changed
     */
    async logPropertyStatusChanged(
        userId: number,
        propertyId: number,
        propertyAddress: string,
        oldStatus: string,
        newStatus: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_STATUS_CHANGED,
            'Property Status Changed',
            `Property status changed from ${oldStatus} to ${newStatus}`,
            {
                propertyId,
                propertyAddress,
                oldStatus,
                newStatus,
                timestamp: new Date().toISOString(),

                uiUpdateHints: {
                    refreshPropertyList: true,
                    updatePropertyDetail: true,
                    refreshDashboard: true
                }
            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }

    /**
     * Log property stats viewed
     */
    async logPropertyStatsViewed(
        userId: number,
        totalProperties: number,
        activeProperties: number,
        totalIncidents: number,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_STATS_VIEWED,
            'Property Stats Viewed',
            `Viewed property statistics: ${totalProperties} properties, ${activeProperties} active, ${totalIncidents} incidents`,
            {
                totalProperties,
                activeProperties,
                totalIncidents,
                timestamp: new Date().toISOString(),
                // Prefetch hints for mobile app
                prefetchHints: {
                    propertyDetails: true,
                    recentIncidents: true,
                    recentInspections: true,
                    propertyImages: true
                }
            },
            metadata,
            'property_stats',
            'property'
        );
    }

    // ===========================================
    // REPOSITORY DELEGATE METHODS
    // ===========================================

    /**
     * Get events for a specific user
     */
    async getEventsForUser(
        userId: number,
        limit: number = 50,
        lastEvaluatedKey?: any,
        startTime?: number,
        endTime?: number
    ) {
        return this.eventRepository.getEventsForUser(userId, limit, lastEvaluatedKey, startTime, endTime);
    }
}
