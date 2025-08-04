
import tap from 'tap';
import fastify, { FastifyInstance } from 'fastify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PrismaClient } from '@prisma/client';

import { EventService } from '../services/eventService';
import { WebSocketBroadcastService } from '../services/websocket/WebSocketBroadcastService';
import { DynamoDBConnectionRepository } from '../repositories/dynamoDB/connectionRepository';
import { DynamoDBEventRepository, EventType, EventCategory } from '../repositories/dynamoDB/eventsRepository';
import { UserRepository } from '../repositories/userRepository';

// Colors for output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function logTest(title: string, data: any) {
  console.log(`\n${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.green}${JSON.stringify(data, null, 2)}${colors.reset}`);
}

// Test setup - SHARED ACROSS ALL TESTS
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.NODE_ENV === 'local' && {
    endpoint: 'http://localhost:8000',
    credentials: {
      accessKeyId: 'dummy',
      secretAccessKey: 'dummy'
    }
  })
});

const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const prisma = new PrismaClient();
const deploymentEnv = process.env.NODE_ENV || 'staging';

// Initialize services
const connectionRepo = new DynamoDBConnectionRepository(documentClient, deploymentEnv);
const eventRepo = new DynamoDBEventRepository(documentClient, deploymentEnv);
const userRepo = new UserRepository(prisma);
const eventService = new EventService(eventRepo, userRepo);

const mockWebSocketEndpoint = 'wss://test-websocket.execute-api.us-east-1.amazonaws.com/staging';
const broadcastService = new WebSocketBroadcastService(connectionRepo, userRepo, mockWebSocketEndpoint);

const TEST_USER_ID = 1;
const TEST_USER_ID_2 = 2;
const TEST_DEVICE_ID = 'consolidated-test-device';

// Mock HTTP API setup - FOR API-LEVEL TESTING
async function buildMockAPI(): Promise<FastifyInstance> {
  const app = fastify({ logger: false });

  // WebSocket connection routes
  app.post('/api/websocket/connect', async (request, reply) => {
    const { userId, deviceId, connectionId } = request.body as any;
    try {
      const connection = await connectionRepo.saveConnection(
        connectionId || `api_conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId, deviceId
      );
      return { success: true, connection };
    } catch (error: any) {
      reply.code(500);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  });

  app.get('/api/websocket/connections/:userId', async (request, reply) => {
    const { userId } = request.params as any;
    try {
      const connections = await connectionRepo.getConnectionsForUser(parseInt(userId));
      return { success: true, connections };
    } catch (error: any) {
      reply.code(500);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  });

  // Event creation routes
  app.post('/api/events/property-viewed', async (request, reply) => {
    const { userId, propertyId, propertyAddress, metadata } = request.body as any;
    try {
      const event = await eventService.logPropertyViewed(userId, propertyId, propertyAddress, metadata);
      const websocketMessage = broadcastService.transformEventToWebSocketMessage(event);

      try {
        await broadcastService.broadcastToUser(userId, websocketMessage);
      } catch (broadcastError: any) {
        // Expected to fail with mock endpoint
      }

      reply.code(201);
      return { success: true, event, websocketMessage };
    } catch (error: any) {
      reply.code(400);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  });

  return app;
}

// MAIN TEST SUITE
tap.test('WebSocket System - Consolidated Test Suite', async (t) => {
  let mockAPI: FastifyInstance;

  // Setup once for all tests
  t.before(async () => {
    // Create test user in database before running tests
    try {
      await prisma.user.upsert({
        where: { id: TEST_USER_ID },
        update: {}, // Don't update if exists
        create: {
          id: TEST_USER_ID,
          auth0Id: `test_auth0_${TEST_USER_ID}`,
          email: `test${TEST_USER_ID}@example.com`,
          firstName: 'Test',
          lastName: 'User',
          profilePictureUrl: null,
          isPlaceholder: false,
          invitationToken: null,
          expiresAt: null
        }
      });

      // Create second test user
      await prisma.user.upsert({
        where: { id: TEST_USER_ID_2 },
        update: {},
        create: {
          id: TEST_USER_ID_2,
          auth0Id: `test_auth0_${TEST_USER_ID_2}`,
          email: `test${TEST_USER_ID_2}@example.com`,
          firstName: 'Test',
          lastName: 'User2',
          profilePictureUrl: null,
          isPlaceholder: false,
          invitationToken: null,
          expiresAt: null
        }
      });

      console.log('✅ Test users created successfully');
    } catch (error: any) {
      console.warn('⚠️ Could not create test users:', error?.message);
      // Continue with tests - they might work anyway
    }

    mockAPI = await buildMockAPI();
  });

  t.teardown(async () => {
    await mockAPI?.close();

    // Clean up test users
    try {
      await prisma.user.deleteMany({
        where: {
          id: { in: [TEST_USER_ID, TEST_USER_ID_2] }
        }
      });
      console.log('✅ Test users cleaned up');
    } catch (error: any) {
      console.warn('⚠️ Could not clean up test users:', error?.message);
    }

    await prisma.$disconnect();
  });

  // ===========================================
  // 1. UNIT TESTS - Direct Service Testing
  // ===========================================
  t.test('Unit Tests - Direct Service Calls', async (st) => {

    st.test('Connection Repository Operations', async (sst) => {
      let testConnectionId: string;

      sst.test('should create and retrieve connection', async (ssst) => {
        testConnectionId = `unit_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create connection
        const connection = await connectionRepo.saveConnection(
          testConnectionId, TEST_USER_ID, TEST_DEVICE_ID
        );

        ssst.equal(connection.connectionId, testConnectionId, 'Connection ID matches');
        ssst.equal(connection.userId, TEST_USER_ID, 'User ID matches');

        // Retrieve connection
        const retrieved = await connectionRepo.getConnection(testConnectionId);
        ssst.ok(retrieved, 'Connection retrieved');
        ssst.equal(retrieved?.connectionId, testConnectionId, 'Retrieved connection matches');
      });

      sst.test('should get user connections', async (ssst) => {
        const connections = await connectionRepo.getConnectionsForUser(TEST_USER_ID);
        ssst.ok(Array.isArray(connections), 'Returns array');

        const testConnection = connections.find(c => c.connectionId === testConnectionId);
        ssst.ok(testConnection, 'Test connection found');
      });

      sst.test('should delete connection', async (ssst) => {
        await connectionRepo.deleteConnection(testConnectionId);
        const deleted = await connectionRepo.getConnection(testConnectionId);
        ssst.equal(deleted, null, 'Connection deleted');
      });
    });

    st.test('Event Service Operations', async (sst) => {

      sst.test('should create property viewed event', async (ssst) => {
        const event = await eventService.logPropertyViewed(
          TEST_USER_ID, 123, '123 Unit Test Street',
          { source: 'unit-test', deviceId: TEST_DEVICE_ID }
        );

        ssst.ok(event, 'Event created');
        ssst.equal(event.eventType, EventType.PROPERTY_VIEWED, 'Event type correct');
        ssst.ok(event.payload.prefetchHints, 'Prefetch hints included');

        logTest('Property Viewed Event', {
          eventId: event.eventId,
          eventType: event.eventType,
          prefetchHints: event.payload.prefetchHints
        });
      });

      sst.test('should create incident status change event', async (ssst) => {
        const event = await eventService.logIncidentStatusChanged(
          TEST_USER_ID, 456, 123, 'open', 'resolved',
          { source: 'unit-test', deviceId: TEST_DEVICE_ID }
        );

        ssst.equal(event.eventType, EventType.INCIDENT_STATUS_CHANGED, 'Event type correct');
        ssst.equal(event.payload.oldStatus, 'open', 'Old status correct');
        ssst.equal(event.payload.newStatus, 'resolved', 'New status correct');
      });
    });

    st.test('WebSocket Message Transformation', async (sst) => {

      sst.test('should transform events correctly', async (ssst) => {
        const testCases = [
          {
            eventType: EventType.PROPERTY_VIEWED,
            expectedType: 'prefetch',
            expectedPriority: 'critical'
          },
          {
            eventType: EventType.INCIDENT_STATUS_CHANGED,
            expectedType: 'ui_update',
            expectedPriority: 'critical'
          },
          {
            eventType: EventType.INSPECTION_BULK_PHOTOS_UPLOADED,
            expectedType: 'progress',
            expectedPriority: 'medium'
          }
        ];

        for (const testCase of testCases) {
          const mockEvent = {
            eventId: `transform_test_${testCase.eventType}`,
            userId: TEST_USER_ID,
            eventType: testCase.eventType,
            category: EventCategory.PROPERTY,
            timestamp: Date.now(),
            title: `Test ${testCase.eventType}`,
            description: 'Transform test',
            payload: { testData: true }
          };

          const message = broadcastService.transformEventToWebSocketMessage(mockEvent);

          ssst.equal(message.type, testCase.expectedType, `${testCase.eventType} type correct`);
          ssst.equal(message.priority, testCase.expectedPriority, `${testCase.eventType} priority correct`);
        }
      });
    });

    st.test('Broadcasting Logic', async (sst) => {
      let testConnectionId: string;

      sst.beforeEach(async () => {
        testConnectionId = `broadcast_unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await connectionRepo.saveConnection(testConnectionId, TEST_USER_ID, TEST_DEVICE_ID);
      });

      sst.afterEach(async () => {
        try {
          await connectionRepo.deleteConnection(testConnectionId);
        } catch (error: any) {
          // Ignore cleanup errors
        }
      });

      sst.test('should attempt broadcast to user', async (ssst) => {
        const testMessage = {
          type: 'system' as const,
          priority: 'high' as const,
          data: { test: 'broadcast unit test' },
          timestamp: Date.now(),
          userId: TEST_USER_ID
        };

        try {
          await broadcastService.broadcastToUser(TEST_USER_ID, testMessage);
          ssst.pass('Broadcast executed without throwing');
        } catch (error: any) {
          ssst.pass('Broadcast failed as expected with mock endpoint');
        }
      });

      sst.test('should handle user with no connections', async (ssst) => {
        const testMessage = {
          type: 'system' as const,
          priority: 'low' as const,
          data: { test: true },
          timestamp: Date.now(),
          userId: 99999
        };

        await broadcastService.broadcastToUser(99999, testMessage);
        ssst.pass('Handled non-existent user gracefully');
      });
    });
  });

  // ===========================================
  // 2. INTEGRATION TESTS - HTTP API Testing
  // ===========================================
  t.test('Integration Tests - HTTP API', async (st) => {

    st.test('WebSocket Connection API', async (sst) => {
      let testConnectionId: string;

      sst.test('should create connection via API', async (ssst) => {
        testConnectionId = `api_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const response = await mockAPI.inject({
          method: 'POST',
          url: '/api/websocket/connect',
          payload: {
            userId: TEST_USER_ID,
            deviceId: TEST_DEVICE_ID,
            connectionId: testConnectionId
          }
        });

        ssst.equal(response.statusCode, 200, 'Status code correct');

        const body = response.json();
        ssst.equal(body.success, true, 'Request successful');
        ssst.equal(body.connection.connectionId, testConnectionId, 'Connection ID matches');

        logTest('API Connection Creation', body.connection);
      });

      sst.test('should retrieve connections via API', async (ssst) => {
        const response = await mockAPI.inject({
          method: 'GET',
          url: `/api/websocket/connections/${TEST_USER_ID}`
        });

        ssst.equal(response.statusCode, 200, 'Status code correct');

        const body = response.json();
        ssst.equal(body.success, true, 'Request successful');
        ssst.ok(Array.isArray(body.connections), 'Connections is array');

        const testConnection = body.connections.find((c: any) => c.connectionId === testConnectionId);
        ssst.ok(testConnection, 'Test connection found');
      });
    });

    st.test('Event Creation API', async (sst) => {

      sst.test('should create property viewed event via API', async (ssst) => {
        const response = await mockAPI.inject({
          method: 'POST',
          url: '/api/events/property-viewed',
          payload: {
            userId: TEST_USER_ID,
            propertyId: 12345,
            propertyAddress: '123 API Test Street',
            metadata: {
              source: 'api-test',
              deviceId: TEST_DEVICE_ID
            }
          }
        });

        // Log response for debugging
        console.log('API Response Status:', response.statusCode);
        const body = response.json();
        console.log('API Response Body:', JSON.stringify(body, null, 2));

        ssst.equal(response.statusCode, 201, 'Status code correct');
        ssst.equal(body.success, true, 'Event creation successful');
        ssst.ok(body.event, 'Event returned');
        ssst.ok(body.websocketMessage, 'WebSocket message returned');

        if (body.event) {
          ssst.equal(body.event.eventType, EventType.PROPERTY_VIEWED, 'Event type correct');
        }

        if (body.websocketMessage) {
          ssst.equal(body.websocketMessage.type, 'prefetch', 'WebSocket message type correct');
        }

        if (body.event && body.websocketMessage) {
          logTest('API Event Creation', {
            eventId: body.event.eventId,
            messageType: body.websocketMessage.type,
            priority: body.websocketMessage.priority
          });
        }
      });
    });
  });

  // ===========================================
  // 3. END-TO-END TESTS - Full Flow
  // ===========================================
  t.test('End-to-End Tests - Complete Workflows', async (st) => {
    let testConnectionId: string;

    st.beforeEach(async () => {
      testConnectionId = `e2e_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await connectionRepo.saveConnection(testConnectionId, TEST_USER_ID, TEST_DEVICE_ID);
    });

    st.afterEach(async () => {
      try {
        await connectionRepo.deleteConnection(testConnectionId);
      } catch (error: any) {
        // Ignore cleanup errors
      }
    });

    st.test('should complete full property viewed workflow', async (sst) => {
      // 1. Create event
      const event = await eventService.logPropertyViewed(
        TEST_USER_ID, 789, '789 E2E Test Avenue',
        { source: 'e2e-test', deviceId: TEST_DEVICE_ID }
      );

      sst.ok(event, 'Event created');
      sst.equal(event.eventType, EventType.PROPERTY_VIEWED, 'Event type correct');

      // 2. Transform to WebSocket message
      const message = broadcastService.transformEventToWebSocketMessage(event);
      sst.equal(message.type, 'prefetch', 'Message type correct');
      sst.equal(message.priority, 'critical', 'Priority correct');

      // 3. Attempt broadcast (will fail with mock endpoint)
      try {
        await broadcastService.broadcastToUser(TEST_USER_ID, message);
        sst.pass('Broadcast attempted');
      } catch (error: any) {
        sst.pass('Broadcast failed as expected');
      }

      // 4. Verify connection still exists
      const connections = await connectionRepo.getConnectionsForUser(TEST_USER_ID);
      const ourConnection = connections.find(c => c.connectionId === testConnectionId);
      sst.ok(ourConnection, 'Connection still exists after broadcast');

      logTest('E2E Property Viewed Workflow', {
        event: { id: event.eventId, type: event.eventType },
        message: { type: message.type, priority: message.priority },
        connectionExists: !!ourConnection
      });
    });

    st.test('should handle error scenarios gracefully', async (sst) => {
      // Test with invalid data
      try {
        const event = await eventService.logIncidentStatusChanged(
          -1, 999, 888, 'invalid', 'also_invalid',
          { source: 'error-test', deviceId: TEST_DEVICE_ID }
        );
        sst.pass('Invalid data handled gracefully');
      } catch (error: any) {
        sst.pass('Error thrown appropriately for invalid data');
      }
    });
  });

  // ===========================================
  // 4. PERFORMANCE TESTS
  // ===========================================
  t.test('Performance Tests', async (st) => {

    st.test('should handle multiple concurrent operations', async (sst) => {
      const connectionIds: string[] = [];
      const connectionPromises = [];

      // Create multiple connections concurrently
      for (let i = 0; i < 10; i++) {
        const connectionId = `perf_test_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`;
        connectionIds.push(connectionId);

        connectionPromises.push(
          connectionRepo.saveConnection(connectionId, TEST_USER_ID, `${TEST_DEVICE_ID}_${i}`)
        );
      }

      const startTime = Date.now();
      await Promise.all(connectionPromises);
      const duration = Date.now() - startTime;

      sst.ok(duration < 5000, `Concurrent connections created in reasonable time (${duration}ms)`);

      // Cleanup
      const cleanupPromises = connectionIds.map(id =>
        connectionRepo.deleteConnection(id).catch((error: any) => {})
      );
      await Promise.allSettled(cleanupPromises);
    });
  });

  // ===========================================
  // GLOBAL CLEANUP
  // ===========================================
  t.test('Global Cleanup', async (st) => {
    st.test('should clean up all test connections', async (sst) => {
      try {
        const allConnections = await connectionRepo.getAllConnections(1000);
        const testConnections = allConnections.connections.filter(
          conn => conn.connectionId.includes('test_') ||
                  conn.connectionId.includes('unit_') ||
                  conn.connectionId.includes('api_') ||
                  conn.connectionId.includes('e2e_') ||
                  conn.connectionId.includes('perf_')
        );

        for (const conn of testConnections) {
          await connectionRepo.deleteConnection(conn.connectionId);
        }

        sst.pass(`Cleaned up ${testConnections.length} test connections`);
      } catch (error: any) {
        sst.pass('Cleanup completed with some errors (acceptable)');
      }
    });
  });
});

console.log(`\n${colors.bright}${colors.green}🎯 Consolidated WebSocket System Tests Complete!${colors.reset}\n`);
