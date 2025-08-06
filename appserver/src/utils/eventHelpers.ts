import { FastifyRequest } from 'fastify';
import { EventMetadata } from '../repositories/dynamoDB/eventsRepository';

/**
 * Helper function to safely extract string from header value
 */
function getHeaderValue(headerValue: string | string[] | undefined): string | undefined {
    if (!headerValue) return undefined;
    if (Array.isArray(headerValue)) {
        return headerValue[0];
    }
    return headerValue;
}

/**
 * Extract basic event metadata
 */
export function getEventMetadata(request: FastifyRequest): EventMetadata {
    const metadata: EventMetadata = {
        ipAddress: request.ip || '127.0.0.1',
        source: getHeaderValue(request.headers['x-app-source']) || 'api'
    };

    // Add optional fields only if they exist
    const userAgent = getHeaderValue(request.headers['user-agent']);
    if (userAgent) metadata.userAgent = userAgent;

    const deviceId = getHeaderValue(request.headers['x-device-id']);
    if (deviceId) metadata.deviceId = deviceId;

    const version = getHeaderValue(request.headers['x-app-version']);
    if (version) metadata.version = version;

    return metadata;
}

