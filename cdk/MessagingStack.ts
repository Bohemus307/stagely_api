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
  public readonly conversationsTable: dynamodb.Table;
  public readonly messagesTable: dynamodb.Table;
  public readonly connectionsTable: dynamodb.Table;
  public readonly messageReadReceiptsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    // Get environment-specific settings
    const isProd = props.deploymentEnv === "production";
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;


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

    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

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
