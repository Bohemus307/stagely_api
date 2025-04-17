// src/cdk/MessagingStack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { APP_NAME } from "./configuration";
import { TableDefinitions, TableNames } from "../appserver/src/config/dynamoTables";

export interface MessagingStackProps extends cdk.StackProps {
  deploymentEnv: string;
}

export class MessagingStack extends cdk.Stack {
  public readonly userTable: dynamodb.Table;
  public readonly propertyUsersTable: dynamodb.Table;
  public readonly conversationsTable: dynamodb.Table;
  public readonly messagesTable: dynamodb.Table;
  public readonly connectionsTable: dynamodb.Table;
  public readonly messageReadReceiptsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    // Get environment-specific settings
    const isProd = props.deploymentEnv === "production";
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Create the Users table
    this.userTable = new dynamodb.Table(this, `${APP_NAME}-UsersTable`, {
      tableName: `${TableNames.USERS}-${props.deploymentEnv}`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: isProd,
      removalPolicy: removalPolicy,
      stream: isProd ? dynamodb.StreamViewType.NEW_AND_OLD_IMAGES : undefined
    });

    // Create the Property Users table
    this.propertyUsersTable = new dynamodb.Table(this, `${APP_NAME}-PropertyUsersTable`, {
      tableName: `${TableNames.PROPERTY_USERS}-${props.deploymentEnv}`,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: isProd,
      removalPolicy: removalPolicy
    });

    // Add GSIs to Property Users table
    this.propertyUsersTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    this.propertyUsersTable.addGlobalSecondaryIndex({
      indexName: 'propertyId-index',
      partitionKey: {
        name: 'propertyId',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create the Conversations table
    this.conversationsTable = new dynamodb.Table(this, `${APP_NAME}-ConversationsTable`, {
      tableName: `${TableNames.CONVERSATIONS}-${props.deploymentEnv}`,
      partitionKey: {
        name: 'conversationId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: isProd,
      removalPolicy: removalPolicy,
      stream: isProd ? dynamodb.StreamViewType.NEW_AND_OLD_IMAGES : undefined
    });

    // Add GSIs to Conversations table
    this.conversationsTable.addGlobalSecondaryIndex({
      indexName: 'propertyId-index',
      partitionKey: {
        name: 'propertyId',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    this.conversationsTable.addGlobalSecondaryIndex({
      indexName: 'participant-index',
      partitionKey: {
        name: 'participantId',
        type: dynamodb.AttributeType.NUMBER
      },
      sortKey: {
        name: 'lastMessageTime',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create the Messages table
    this.messagesTable = new dynamodb.Table(this, `${APP_NAME}-MessagesTable`, {
      tableName: `${TableNames.MESSAGES}-${props.deploymentEnv}`,
      partitionKey: {
        name: 'messageId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'conversationId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: isProd,
      removalPolicy: removalPolicy,
      stream: isProd ? dynamodb.StreamViewType.NEW_AND_OLD_IMAGES : undefined
    });

    // Add GSIs to Messages table
    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'conversationId-timestamp-index',
      partitionKey: {
        name: 'conversationId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'senderId-timestamp-index',
      partitionKey: {
        name: 'senderId',
        type: dynamodb.AttributeType.NUMBER
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create the Connections table (for WebSocket)
    this.connectionsTable = new dynamodb.Table(this, `${APP_NAME}-ConnectionsTable`, {
      tableName: `${TableNames.CONNECTIONS}-${props.deploymentEnv}`,
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY // Always DESTROY for connection data
    });

    // Add GSI to Connections table
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create the Message Read Receipts table
    this.messageReadReceiptsTable = new dynamodb.Table(this, `${APP_NAME}-MessageReadReceiptsTable`, {
      tableName: `${TableNames.MESSAGE_READ_RECEIPTS}-${props.deploymentEnv}`,
      partitionKey: {
        name: 'receiptId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: isProd,
      removalPolicy: removalPolicy
    });

    // Add GSI to Message Read Receipts table
    this.messageReadReceiptsTable.addGlobalSecondaryIndex({
      indexName: 'conversationId-userId-index',
      partitionKey: {
        name: 'conversationId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Output the table names
    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.userTable.tableName,
      description: 'DynamoDB Users Table Name',
      exportName: `${APP_NAME}-${props.deploymentEnv}-UsersTableName`,
    });

    new cdk.CfnOutput(this, 'PropertyUsersTableName', {
      value: this.propertyUsersTable.tableName,
      description: 'DynamoDB Property Users Table Name',
      exportName: `${APP_NAME}-${props.deploymentEnv}-PropertyUsersTableName`,
    });

    new cdk.CfnOutput(this, 'ConversationsTableName', {
      value: this.conversationsTable.tableName,
      description: 'DynamoDB Conversations Table Name',
      exportName: `${APP_NAME}-${props.deploymentEnv}-ConversationsTableName`,
    });

    new cdk.CfnOutput(this, 'MessagesTableName', {
      value: this.messagesTable.tableName,
      description: 'DynamoDB Messages Table Name',
      exportName: `${APP_NAME}-${props.deploymentEnv}-MessagesTableName`,
    });

    new cdk.CfnOutput(this, 'ConnectionsTableName', {
      value: this.connectionsTable.tableName,
      description: 'DynamoDB Connections Table Name',
      exportName: `${APP_NAME}-${props.deploymentEnv}-ConnectionsTableName`,
    });

    new cdk.CfnOutput(this, 'MessageReadReceiptsTableName', {
      value: this.messageReadReceiptsTable.tableName,
      description: 'DynamoDB Message Read Receipts Table Name',
      exportName: `${APP_NAME}-${props.deploymentEnv}-MessageReadReceiptsTableName`,
    });
  }
}
