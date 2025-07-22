import { FastifyRequest } from 'fastify';
import { EventMetadata } from '../repositories/dynamoDB/eventsRepository';

/**
 * Helper function to safely extract string from header value
 */
function getHeaderValue(headerValue: string | string[] | undefined): string | undefined {
    if (!headerValue) return undefined;
    if (Array.isArray(headerValue)) {
        return headerValue[0]; // Take the first value if it's an array
    }
    return headerValue;
}

/**
 * Helper to clean values for DynamoDB (removes undefined, null, NaN)
 */
function cleanForDynamoDB(value: any): any {
    if (value === undefined || value === null || Number.isNaN(value)) {
        return undefined; // Will be filtered out
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const cleaned: any = {};
        for (const [key, val] of Object.entries(value)) {
            const cleanedVal = cleanForDynamoDB(val);
            if (cleanedVal !== undefined) {
                cleaned[key] = cleanedVal;
            }
        }
        return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }
    return value;
}

/**
 * Extract event metadata from request - DynamoDB safe
 */
export function getEventMetadata(request: FastifyRequest): EventMetadata {
    const startTime = (request as any).startTime || Date.now();
    const duration = Date.now() - startTime;

    // Calculate duration safely
    const safeDuration = Number.isFinite(duration) ? duration : undefined;

    const rawMetadata = {
        ipAddress: request.ip || '127.0.0.1',
        userAgent: getHeaderValue(request.headers['user-agent']),
        source: getHeaderValue(request.headers['x-app-source']) || 'api', // mobile, web, api
        deviceId: getHeaderValue(request.headers['x-device-id']),
        version: getHeaderValue(request.headers['x-app-version']),
        performanceMetrics: {
            duration: safeDuration,
            memoryUsage: process.memoryUsage().heapUsed,
            queryCount: (request as any).queryCount || 0,
            cacheHit: (request as any).cacheHit || false
        }
    };

    // Clean the metadata to remove undefined values
    return cleanForDynamoDB(rawMetadata) as EventMetadata;
}

/**
 * Compare objects to detect changed fields for event logging
 */
export function getChangedFields(oldObject: any, newObject: any): string[] {
    const changedFields: string[] = [];

    // Get all keys from both objects
    const allKeys = new Set([...Object.keys(oldObject), ...Object.keys(newObject)]);

    for (const key of allKeys) {
        // Skip certain fields that we don't want to track
        if (['updatedAt', 'createdAt', 'id'].includes(key)) {
            continue;
        }

        const oldValue = oldObject[key];
        const newValue = newObject[key];

        // Handle null/undefined comparison
        if (oldValue !== newValue) {
            // For dates, convert to ISO string for comparison
            if (oldValue instanceof Date && newValue instanceof Date) {
                if (oldValue.getTime() !== newValue.getTime()) {
                    changedFields.push(key);
                }
            } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                changedFields.push(key);
            }
        }
    }

    return changedFields;
}
