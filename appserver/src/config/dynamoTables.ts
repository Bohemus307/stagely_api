// src/config/dynamoDBTables.ts
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
} from "aws-cdk-lib/aws-dynamodb";

/**
 * Names of all DynamoDB tables used in the messaging system
 * Note: Removed redundant USERS table - we'll use Postgres user data instead
 */
export const TableNames = {
  CONVERSATIONS: "stagely-conversations",
  MESSAGES: "stagely-messages",
  CONNECTIONS: "stagely-connections",
  MESSAGE_READ_RECEIPTS: "stagely-message-read-receipts",
  EVENTS: "events",
  EVENT_AGGREGATIONS: "event-aggregations",
};

/**
 * Complete table definitions for CDK deployment
 * Note: Removed redundant USERS table to avoid duplication with Postgres
 */
export const TableDefinitions = {
  // Conversations Table
  CONVERSATIONS: {
    tableName: TableNames.CONVERSATIONS,
    partitionKey: {
      name: "conversationId",
      type: AttributeType.STRING,
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: "participant-index",
        partitionKey: {
          name: "participantId",
          type: AttributeType.NUMBER,
        },
        sortKey: {
          name: "lastMessageTime",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
    ],
    pointInTimeRecovery: true,
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: "DESTROY", // Change to RETAIN for production
  },

  // Messages Table
  MESSAGES: {
    tableName: TableNames.MESSAGES,
    partitionKey: {
      name: "messageId",
      type: AttributeType.STRING,
    },
    sortKey: {
      name: "conversationId",
      type: AttributeType.STRING,
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: "conversationId-timestamp-index",
        partitionKey: {
          name: "conversationId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "timestamp",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
      {
        indexName: "senderId-timestamp-index",
        partitionKey: {
          name: "senderId",
          type: AttributeType.NUMBER,
        },
        sortKey: {
          name: "timestamp",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
    ],
    pointInTimeRecovery: true,
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: "DESTROY", // Change to RETAIN for production
  },

  // WebSocket Connections Table - Real-time messaging connections
  CONNECTIONS: {
    tableName: TableNames.CONNECTIONS,
    partitionKey: {
      name: "connectionId",
      type: AttributeType.STRING,
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: "userId-index",
        partitionKey: {
          name: "userId",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
    ],
    timeToLiveAttribute: "ttl",
    removalPolicy: "DESTROY", // This is appropriate for connection data
  },

  // Message Read Receipts Table - Tracks which messages have been read
  MESSAGE_READ_RECEIPTS: {
    tableName: TableNames.MESSAGE_READ_RECEIPTS,
    partitionKey: {
      name: "receiptId",
      type: AttributeType.STRING,
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: "conversationId-userId-index",
        partitionKey: {
          name: "conversationId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "userId",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
    ],
    pointInTimeRecovery: true,
    removalPolicy: "DESTROY", // Change to RETAIN for production
  },

  // Events Table - Application-wide event tracking
  EVENTS: {
    tableName: TableNames.EVENTS,
    partitionKey: {
      name: "eventId",
      type: AttributeType.STRING,
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: "userId-timestamp-index",
        partitionKey: {
          name: "userId",
          type: AttributeType.NUMBER,
        },
        sortKey: {
          name: "timestamp",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
      {
        indexName: "eventType-timestamp-index",
        partitionKey: {
          name: "eventType",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "timestamp",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
      {
        indexName: "entityId-timestamp-index",
        partitionKey: {
          name: "entityId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "timestamp",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
      {
        indexName: "datePartition-timestamp-index",
        partitionKey: {
          name: "datePartition",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "timestamp",
          type: AttributeType.NUMBER,
        },
        projectionType: ProjectionType.ALL,
      },
    ],
    pointInTimeRecovery: true,
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
    timeToLiveAttribute: "ttl", // Auto-delete old events
    removalPolicy: "DESTROY", // Change to RETAIN for production
  },

  // Event Aggregations Table - Metrics and analytics
  EVENT_AGGREGATIONS: {
    tableName: TableNames.EVENT_AGGREGATIONS,
    partitionKey: {
      name: "aggregationKey",
      type: AttributeType.STRING,
    },
    sortKey: {
      name: "timePeriod",
      type: AttributeType.STRING,
    },
    billingMode: BillingMode.PAY_PER_REQUEST,
    globalSecondaryIndexes: [
      {
        indexName: "aggregationType-timePeriod-index",
        partitionKey: {
          name: "aggregationType",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "timePeriod",
          type: AttributeType.STRING,
        },
        projectionType: ProjectionType.ALL,
      },
    ],
    pointInTimeRecovery: true,
    timeToLiveAttribute: "ttl", // Auto-delete old aggregations
    removalPolicy: "DESTROY", // Change to RETAIN for production
  },
};

/**
 * Sample DynamoDB record schemas (for documentation/reference)
 * Note: Removed USER sample and updated references to use Postgres user IDs
 */
export const SampleRecords = {
  CONVERSATION: {
    conversationId: "conv_123456789",
    participants: [1, 2, 3], // User IDs from Postgres users table
    conversationType: "general", // Only support general type now
    createdAt: 1617048800000,
    lastMessageText: "When will the plumber arrive?",
    lastMessageTime: 1618048800000,
    lastMessageSenderId: 1,
    unreadCount: {
      "1": 0,
      "2": 2,
      "3": 1,
    },
    // For the participant-index GSI
    participantId: 1, // This field is duplicated for each participant
  },

  MESSAGE: {
    messageId: "msg_123456789",
    conversationId: "conv_123456789",
    senderId: 1, // References Postgres users.user_id
    text: "When will the plumber arrive?",
    timestamp: 1618048800000,
    status: {
      "2": "READ",
      "3": "DELIVERED",
    },
  },

  CONNECTION: {
    connectionId: "conn_123456789",
    userId: 1, // References Postgres users.user_id
    deviceId: "device_123",
    timestamp: 1618048800000,
    ttl: 1618135200, // 24 hours later in seconds since epoch
  },

  MESSAGE_READ_RECEIPT: {
    receiptId: "1#msg_123456789", // Composite "userId#messageId"
    userId: 1, // References Postgres users.user_id
    messageId: "msg_123456789",
    conversationId: "conv_123456789",
    timestamp: 1618048800000,
  },
};
