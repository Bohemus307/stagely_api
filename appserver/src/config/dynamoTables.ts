// src/config/dynamoDBTables.ts
import { AttributeType, BillingMode, ProjectionType, StreamViewType } from 'aws-cdk-lib/aws-dynamodb';

/**
 * Names of all DynamoDB tables used in the messaging system
 */
export const TableNames = {
  USERS: 'stagely-users',
  PROPERTY_USERS: 'stagely-property-users',
  CONVERSATIONS: 'stagely-conversations',
  MESSAGES: 'stagely-messages',
  CONNECTIONS: 'stagely-connections',
  MESSAGE_READ_RECEIPTS: 'stagely-message-read-receipts'
};

/**
 * Complete table definitions for CDK deployment
 */
export const TableDefinitions = {
  // Users Table
  USERS: {
    tableName: TableNames.USERS,
    partitionKey: {
      name: 'userId',
      type: AttributeType.STRING
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'ttl',
    pointInTimeRecovery: true,
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: 'DESTROY' // Change to RETAIN for production
  },

  // Property Users Table
  PROPERTY_USERS: {
    tableName: TableNames.PROPERTY_USERS,
    partitionKey: {
      name: 'id',
      type: AttributeType.STRING
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: 'userId-index',
        partitionKey: {
          name: 'userId',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      },
      {
        indexName: 'propertyId-index',
        partitionKey: {
          name: 'propertyId',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      }
    ],
    pointInTimeRecovery: true,
    removalPolicy: 'DESTROY' // Change to RETAIN for production
  },

  // Conversations Table
  CONVERSATIONS: {
    tableName: TableNames.CONVERSATIONS,
    partitionKey: {
      name: 'conversationId',
      type: AttributeType.STRING
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: 'propertyId-index',
        partitionKey: {
          name: 'propertyId',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      },
      {
        indexName: 'participant-index',
        partitionKey: {
          name: 'participantId',
          type: AttributeType.NUMBER
        },
        sortKey: {
          name: 'lastMessageTime',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      }
    ],
    pointInTimeRecovery: true,
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: 'DESTROY' // Change to RETAIN for production
  },

  // Messages Table
  MESSAGES: {
    tableName: TableNames.MESSAGES,
    partitionKey: {
      name: 'messageId',
      type: AttributeType.STRING
    },
    sortKey: {
      name: 'conversationId',
      type: AttributeType.STRING
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: 'conversationId-timestamp-index',
        partitionKey: {
          name: 'conversationId',
          type: AttributeType.STRING
        },
        sortKey: {
          name: 'timestamp',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      },
      {
        indexName: 'senderId-timestamp-index',
        partitionKey: {
          name: 'senderId',
          type: AttributeType.NUMBER
        },
        sortKey: {
          name: 'timestamp',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      }
    ],
    pointInTimeRecovery: true,
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: 'DESTROY' // Change to RETAIN for production
  },

  // WebSocket Connections Table
  CONNECTIONS: {
    tableName: TableNames.CONNECTIONS,
    partitionKey: {
      name: 'connectionId',
      type: AttributeType.STRING
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: 'userId-index',
        partitionKey: {
          name: 'userId',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      }
    ],
    timeToLiveAttribute: 'ttl',
    removalPolicy: 'DESTROY' // This is appropriate for connection data
  },

  // Message Read Receipts Table
  MESSAGE_READ_RECEIPTS: {
    tableName: TableNames.MESSAGE_READ_RECEIPTS,
    partitionKey: {
      name: 'receiptId',
      type: AttributeType.STRING
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: 'conversationId-userId-index',
        partitionKey: {
          name: 'conversationId',
          type: AttributeType.STRING
        },
        sortKey: {
          name: 'userId',
          type: AttributeType.NUMBER
        },
        projectionType: ProjectionType.ALL
      }
    ],
    pointInTimeRecovery: true,
    removalPolicy: 'DESTROY' // Change to RETAIN for production
  }
};

/**
 * Sample DynamoDB record schemas (for documentation/reference)
 */
export const SampleRecords = {
  USER: {
    userId: "auth0|123456789", // Auth0 user ID as string
    email: "user@example.com",
    firstName: "John",
    lastName: "Doe",
    profilePictureUrl: "https://example.com/profile.jpg",
    lastSeen: 1618048800000, // timestamp in milliseconds
    createdAt: 1617048800000,
    updatedAt: 1618048800000,
    ttl: 1649584800 // Optional TTL in seconds since epoch
  },

  PROPERTY_USER: {
    id: "1#42", // Composite "userId#propertyId"
    userId: 1,
    propertyId: 42,
    joinedAt: 1617048800000
  },

  CONVERSATION: {
    conversationId: "conv_123456789",
    participants: [1, 2, 3], // User IDs as numbers
    propertyId: 42,
    propertyAddress: "123 Main St, Anytown, CA",
    conversationType: "property_related", // or "incident_related", "general"
    incidentId: 123, // Optional reference to specific incident
    createdAt: 1617048800000,
    lastMessageText: "When will the plumber arrive?",
    lastMessageTime: 1618048800000,
    lastMessageSenderId: 1,
    unreadCount: {
      "1": 0,
      "2": 2,
      "3": 1
    },
    // For the participant-index GSI
    participantId: 1 // This field is duplicated for each participant
  },

  MESSAGE: {
    messageId: "msg_123456789",
    conversationId: "conv_123456789",
    senderId: 1,
    text: "When will the plumber arrive?",
    timestamp: 1618048800000,
    status: {
      "2": "READ",
      "3": "DELIVERED"
    },
  },

  CONNECTION: {
    connectionId: "conn_123456789",
    userId: 1,
    deviceId: "device_123",
    timestamp: 1618048800000,
    ttl: 1618135200 // 24 hours later in seconds since epoch
  },

  MESSAGE_READ_RECEIPT: {
    receiptId: "1#msg_123456789", // Composite "userId#messageId"
    userId: 1,
    messageId: "msg_123456789",
    conversationId: "conv_123456789",
    timestamp: 1618048800000
  }
};
