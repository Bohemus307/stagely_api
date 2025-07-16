// src/services/eventService.ts

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
            // User events
            [EventType.USER_LOGIN]: EventCategory.USER,
            [EventType.USER_CREATED]: EventCategory.USER,
            [EventType.USER_INVITATION_SENT]: EventCategory.USER,
            [EventType.USER_INVITATION_ACCEPTED]: EventCategory.USER,

            // Messaging events
            [EventType.MESSAGE_SENT]: EventCategory.MESSAGING,
            [EventType.MESSAGE_RECEIVED]: EventCategory.MESSAGING,
            [EventType.MESSAGE_READ]: EventCategory.MESSAGING,
            [EventType.CONVERSATION_CREATED]: EventCategory.MESSAGING,
            [EventType.CONVERSATION_JOINED]: EventCategory.MESSAGING,
            [EventType.CONVERSATION_LEFT]: EventCategory.MESSAGING,

            // Property events
            [EventType.PROPERTY_CREATED]: EventCategory.PROPERTY,
            [EventType.PROPERTY_DELETED]: EventCategory.PROPERTY,
            [EventType.PROPERTY_VIEWED]: EventCategory.PROPERTY,
            [EventType.PROPERTY_ARCHIVED]: EventCategory.PROPERTY,
            [EventType.PROPERTY_RESTORED]: EventCategory.PROPERTY,

            // Incident events
            [EventType.INCIDENT_CREATED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_RESOLVED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_VIEWED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_STATUS_CHANGED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_SEVERITY_CHANGED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_IMAGE_UPLOADED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_IMAGE_DELETED]: EventCategory.INCIDENT,
            [EventType.INCIDENT_CLASSIFIED]: EventCategory.INCIDENT,

            // Inspection events
            [EventType.INSPECTION_CREATED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_COMPLETED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_DELETED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_VIEWED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_PHOTO_UPLOADED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_PHOTO_DELETED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_PHOTO_CLASSIFIED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_BULK_PHOTOS_UPLOADED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_PHOTO_UPDATED]: EventCategory.INSPECTION,
            [EventType.INSPECTION_STATS_VIEWED]: EventCategory.INSPECTION,
        };

        return categoryMap[eventType];
    }

    /**
     * Create a new event with user validation
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
     * Log property viewed - triggers prefetching
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
                // Prefetch hints for mobile app
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
     * Log incident viewed - triggers prefetching
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
                // Prefetch hints for mobile app
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
     * Log inspection viewed - triggers prefetching
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
                // Prefetch hints for mobile app
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
     * Log incident status changed - immediate UI update
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
                // UI update hints
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
     * Log incident severity changed - immediate UI update
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
                // UI update hints
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
     * Log inspection completed - triggers sync
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
                // Sync hints
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
     * HIGH: Log user login - security and analytics
     */
    async logUserLogin(
        userId: number,
        email: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.USER_LOGIN,
            'User Login',
            `User ${email} logged in`,
            {
                email,
                loginTime: new Date().toISOString(),
                deviceInfo: metadata?.deviceId ? { deviceId: metadata.deviceId } : undefined
            },
            metadata
        );
    }

    /**
     * HIGH: Log user created - user lifecycle tracking
     */
    async logUserCreated(
        userId: number,
        email: string,
        firstName: string,
        lastName: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.USER_CREATED,
            'User Created',
            `New user ${firstName} ${lastName} joined the platform`,
            {
                email,
                firstName,
                lastName,
                registrationTime: new Date().toISOString(),
                registrationMethod: 'direct' // Could be 'invitation' if applicable
            },
            metadata,
            userId.toString(),
            'user'
        );
    }

    /**
     * HIGH: Log user invitation sent - growth tracking
     */
    async logUserInvitationSent(
        userId: number,
        invitedEmail: string,
        invitedByUserId: number,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.USER_INVITATION_SENT,
            'User Invitation Sent',
            `User invitation sent to ${invitedEmail}`,
            {
                invitedEmail,
                invitedByUserId,
                invitationTime: new Date().toISOString()
            },
            metadata,
            userId.toString(),
            'user'
        );
    }

    /**
     * HIGH: Log user invitation accepted - conversion tracking
     */
    async logUserInvitationAccepted(
        userId: number,
        email: string,
        invitationToken: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.USER_INVITATION_ACCEPTED,
            'User Invitation Accepted',
            `User ${email} accepted invitation`,
            {
                email,
                invitationToken: invitationToken.substring(0, 8) + '...', // Don't log full token
                acceptedTime: new Date().toISOString()
            },
            metadata,
            userId.toString(),
            'user'
        );
    }
    
     /**
     * HIGH: Log property created - onboarding workflow
     */
    async logPropertyCreated(
        userId: number,
        propertyId: number,
        propertyAddress: string,
        propertyType?: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_CREATED,
            'Property Created',
            `Property ${propertyAddress} created`,
            {
                propertyId,
                propertyAddress,
                propertyType,
                timestamp: new Date().toISOString(),
                // Sync hints for mobile app
                syncHints: {
                    refreshPropertyList: true,
                    updateUserStats: true
                }
            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }

    /**
     * HIGH: Log property deleted - data cleanup
     */
    async logPropertyDeleted(
        userId: number,
        propertyId: number,
        propertyAddress: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_DELETED,
            'Property Deleted',
            `Property ${propertyAddress} deleted`,
            {
                propertyId,
                propertyAddress,
                timestamp: new Date().toISOString(),
                // Cleanup hints
                cleanupHints: {
                    removeFromCache: true,
                    cleanupRelatedData: true,
                    updateUserStats: true
                }
            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }

    /**
     * HIGH: Log property archived
     */
    async logPropertyArchived(
        userId: number,
        propertyId: number,
        propertyAddress: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_ARCHIVED,
            'Property Archived',
            `Property ${propertyAddress} archived`,
            {
                propertyId,
                propertyAddress,
                timestamp: new Date().toISOString(),
                // Status change hints
                statusChangeHints: {
                    refreshPropertyList: true,
                    updateUserStats: true,
                    moveToArchived: true
                }
            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }

    /**
     * HIGH: Log property restored
     */
    async logPropertyRestored(
        userId: number,
        propertyId: number,
        propertyAddress: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.PROPERTY_RESTORED,
            'Property Restored',
            `Property ${propertyAddress} restored from archive`,
            {
                propertyId,
                propertyAddress,
                timestamp: new Date().toISOString(),
                // Status change hints
                statusChangeHints: {
                    refreshPropertyList: true,
                    updateUserStats: true,
                    moveFromArchived: true
                }
            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }

    /**
     * HIGH: Log incident created - workflow triggers
     */
    async logIncidentCreated(
        userId: number,
        incidentId: number,
        propertyId: number,
        incidentType: string,
        severity: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INCIDENT_CREATED,
            'Incident Created',
            `${incidentType} incident created with ${severity} severity`,
            {
                incidentId,
                propertyId,
                incidentType,
                severity,
                timestamp: new Date().toISOString(),
                // Mobile app hints
                syncHints: {
                    refreshIncidentList: true,
                    updatePropertyStats: true,
                    sendNotifications: true
                }
            },
            metadata,
            incidentId.toString(),
            'incident'
        );
    }

    /**
     * HIGH: Log incident resolved - completion tracking
     */
    async logIncidentResolved(
        userId: number,
        incidentId: number,
        propertyId: number,
        incidentType: string,
        resolutionTime: number,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INCIDENT_RESOLVED,
            'Incident Resolved',
            `${incidentType} incident resolved`,
            {
                incidentId,
                propertyId,
                incidentType,
                resolutionTime,
                timestamp: new Date().toISOString(),
                // Completion hints
                completionHints: {
                    refreshIncidentList: true,
                    updatePropertyStats: true,
                    trackResolutionTime: true,
                    sendCompletionNotifications: true
                }
            },
            metadata,
            incidentId.toString(),
            'incident'
        );
    }

    /**
     * HIGH: Log inspection created - workflow triggers
     */
     async logInspectionCreated(
        userId: number,
        inspectionId: number,
        propertyId: number,
        inspectionTitle: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_CREATED,
            'Inspection Created',
            `Inspection "${inspectionTitle}" created`,
            {
                inspectionId,
                propertyId,
                inspectionTitle,
                timestamp: new Date().toISOString(),
                // Mobile app hints
                syncHints: {
                    refreshInspectionList: true,
                    updatePropertyStats: true
                }
            },
            metadata,
            inspectionId.toString(),
            'inspection'
        );
    }

    /**
     * HIGH: Log inspection deleted
     */
    async logInspectionDeleted(
        userId: number,
        inspectionId: number,
        propertyId: number,
        inspectionTitle: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_DELETED,
            'Inspection Deleted',
            `Inspection "${inspectionTitle}" deleted`,
            {
                inspectionId,
                propertyId,
                inspectionTitle,
                timestamp: new Date().toISOString(),
                // Cleanup hints
                cleanupHints: {
                    removeFromCache: true,
                    cleanupPhotos: true,
                    updatePropertyStats: true
                }
            },
            metadata,
            inspectionId.toString(),
            'inspection'
        );
    }

    // ===========================================
    // MESSAGING EVENTS (HIGH PRIORITY)
    // ===========================================

async logMessageSent(
    userId: number,
    messageId: string,
    conversationId: string,
    textLength: number,
    recipientCount: number,
    metadata?: EventMetadata
): Promise<DynamoDBEvent> {
    return this.createEvent(
        userId,
        EventType.MESSAGE_SENT,
        'Message Sent',
        `Message sent to ${recipientCount} recipients`,
        {
            messageId,
            conversationId,
            textLength,
            recipientCount,
            timestamp: new Date().toISOString(),
            // Real-time sync hints
            syncHints: {
                updateConversationList: true,
                sendPushNotifications: true,
                updateLastMessage: true
            }
        },
        metadata,
        messageId,
        'message'
    );
}

    /**
 * Log message received event
 */
async logMessageReceived(
    userId: number,
    messageId: string,
    conversationId: string,
    senderId: number,
    metadata?: EventMetadata
): Promise<DynamoDBEvent> {
    return this.createEvent(
        userId,
        EventType.MESSAGE_RECEIVED,
        'Message Received',
        `Message received from user ${senderId}`,
        {
            messageId,
            conversationId,
            senderId,
            timestamp: new Date().toISOString(),
            // Real-time sync hints
            syncHints: {
                updateUnreadCount: true,
                refreshConversation: true,
                showNotification: true
            }
        },
        metadata,
        messageId,
        'message'
    );
}

     /**
 * Log conversation created event
 */
async logConversationCreated(
    userId: number,
    conversationId: string,
    participantCount: number,
    conversationType: string,
    hasInitialMessage: boolean,
    metadata?: EventMetadata
): Promise<DynamoDBEvent> {
    return this.createEvent(
        userId,
        EventType.CONVERSATION_CREATED,
        'Conversation Created',
        `${conversationType} conversation created with ${participantCount} participants`,
        {
            conversationId,
            participantCount,
            conversationType,
            hasInitialMessage,
            timestamp: new Date().toISOString(),
            // Mobile app hints
            syncHints: {
                refreshConversationList: true,
                updateUnreadCount: true,
                sendNotifications: true
            }
        },
        metadata,
        conversationId,
        'conversation'
    );
}

    // ===========================================
    // MEDIUM PRIORITY EVENTS (Keep some for completeness)
    // ===========================================


    /**
     * Log bulk photos uploaded - progress tracking
     */
    async logInspectionBulkPhotosUploaded(
        userId: number,
        inspectionId: number,
        propertyId: number,
        photoCount: number,
        uploadedBytes: number,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_BULK_PHOTOS_UPLOADED,
            'Bulk Photos Uploaded',
            `${photoCount} photos uploaded for inspection`,
            {
                inspectionId,
                propertyId,
                photoCount,
                uploadedBytes,
                timestamp: new Date().toISOString(),
                // Progress tracking
                progressHints: {
                    totalPhotos: photoCount,
                    completedPhotos: photoCount,
                    totalBytes: uploadedBytes,
                    processingRequired: true
                }
            },
            metadata,
            inspectionId.toString(),
            'inspection'
        );
    }

    /**
     * MEDIUM: Log inspection photo uploaded
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
                // Processing hints
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
     * MEDIUM: Log incident image uploaded
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
                // Processing hints
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
     * Log inspection stats viewed - analytics
     */
    async logInspectionStatsViewed(
        userId: number,
        propertyId: number,
        statsType: string,
        metadata?: EventMetadata
    ): Promise<DynamoDBEvent> {
        return this.createEvent(
            userId,
            EventType.INSPECTION_STATS_VIEWED,
            'Inspection Stats Viewed',
            `${statsType} inspection statistics viewed`,
            {
                propertyId,
                statsType,
                timestamp: new Date().toISOString(),
                // Analytics hints
                analyticsHints: {
                    generateReport: true,
                    cacheStats: true,
                    trackUsage: true
                }
            },
            metadata,
            propertyId.toString(),
            'property'
        );
    }


    // ===========================================
    // REPOSITORY DELEGATE METHODS
    // ===========================================

    async getEventsForUser(
        userId: number,
        limit: number = 50,
        lastEvaluatedKey?: any,
        startTime?: number,
        endTime?: number
    ) {
        return this.eventRepository.getEventsForUser(userId, limit, lastEvaluatedKey, startTime, endTime);
    }

    async getEventsByType(
        eventType: EventType,
        limit: number = 50,
        lastEvaluatedKey?: any,
        startTime?: number,
        endTime?: number
    ) {
        return this.eventRepository.getEventsByType(eventType, limit, lastEvaluatedKey, startTime, endTime);
    }

    async getEventsByCategory(
        category: EventCategory,
        limit: number = 50,
        lastEvaluatedKey?: any,
        startTime?: number,
        endTime?: number
    ) {
        return this.eventRepository.getEventsByCategory(category, limit, lastEvaluatedKey, startTime, endTime);
    }

    async getEventsWithFilters(
        userId?: number,
        eventTypes?: EventType[],
        categories?: EventCategory[],
        startTime?: number,
        endTime?: number,
        limit: number = 50,
        lastEvaluatedKey?: any
    ) {
        return this.eventRepository.getEventsWithFilters(
            userId,
            eventTypes,
            categories,
            startTime,
            endTime,
            limit,
            lastEvaluatedKey
        );
    }
}
