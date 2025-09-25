// src/cdk/EventsStack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { APP_NAME } from "./configuration";
import {
  TableDefinitions,
  TableNames,
} from "../appserver/src/config/dynamoTables";

export interface EventsStackProps extends cdk.StackProps {
  deploymentEnv: string;
}

export class EventsStack extends cdk.Stack {
  public readonly eventsTable: dynamodb.Table;
  public readonly eventAggregationsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);

    // Get environment-specific settings
    const isProd = props.deploymentEnv === "production";
    const removalPolicy = isProd
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // Create the Events table
    this.eventsTable = new dynamodb.Table(this, `${APP_NAME}-EventsTable`, {
      tableName: `${TableNames.EVENTS}-${props.deploymentEnv}`,
      partitionKey: {
        name: "eventId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      removalPolicy: removalPolicy,
      stream: isProd ? dynamodb.StreamViewType.NEW_AND_OLD_IMAGES : undefined,
      timeToLiveAttribute: "ttl", // Optional: auto-delete old events
    });

    // Add GSI for querying events by userId and timestamp
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: "userId-timestamp-index",
      partitionKey: {
        name: "userId",
        type: dynamodb.AttributeType.NUMBER,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for querying events by eventType and timestamp
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: "eventType-timestamp-index",
      partitionKey: {
        name: "eventType",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for querying events by entityId and timestamp
    // Useful for tracking all events related to a specific entity
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: "entityId-timestamp-index",
      partitionKey: {
        name: "entityId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for querying events by date partition (for daily/hourly aggregations)
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: "datePartition-timestamp-index",
      partitionKey: {
        name: "datePartition",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create the Event Aggregations table for metrics and analytics
    this.eventAggregationsTable = new dynamodb.Table(
      this,
      `${APP_NAME}-EventAggregationsTable`,
      {
        tableName: `${TableNames.EVENT_AGGREGATIONS}-${props.deploymentEnv}`,
        partitionKey: {
          name: "aggregationKey",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "timePeriod",
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
        removalPolicy: removalPolicy,
        timeToLiveAttribute: "ttl", // Auto-delete old aggregations
      }
    );

    // Add GSI for querying aggregations by type and time
    this.eventAggregationsTable.addGlobalSecondaryIndex({
      indexName: "aggregationType-timePeriod-index",
      partitionKey: {
        name: "aggregationType",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timePeriod",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Output the table names
    new cdk.CfnOutput(this, "EventsTableName", {
      value: this.eventsTable.tableName,
      description: "DynamoDB Events Table Name",
      exportName: `${APP_NAME}-${props.deploymentEnv}-EventsTableName`,
    });

    new cdk.CfnOutput(this, "EventAggregationsTableName", {
      value: this.eventAggregationsTable.tableName,
      description: "DynamoDB Event Aggregations Table Name",
      exportName: `${APP_NAME}-${props.deploymentEnv}-EventAggregationsTableName`,
    });

    // Output the table ARNs for cross-stack references
    new cdk.CfnOutput(this, "EventsTableArn", {
      value: this.eventsTable.tableArn,
      description: "DynamoDB Events Table ARN",
      exportName: `${APP_NAME}-${props.deploymentEnv}-EventsTableArn`,
    });

    new cdk.CfnOutput(this, "EventAggregationsTableArn", {
      value: this.eventAggregationsTable.tableArn,
      description: "DynamoDB Event Aggregations Table ARN",
      exportName: `${APP_NAME}-${props.deploymentEnv}-EventAggregationsTableArn`,
    });

    // Output the stream ARN if in production (useful for Lambda triggers)
    if (isProd && this.eventsTable.tableStreamArn) {
      new cdk.CfnOutput(this, "EventsTableStreamArn", {
        value: this.eventsTable.tableStreamArn,
        description: "DynamoDB Events Table Stream ARN",
        exportName: `${APP_NAME}-${props.deploymentEnv}-EventsTableStreamArn`,
      });
    }
  }
}
