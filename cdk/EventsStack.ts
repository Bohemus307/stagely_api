import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { APP_NAME } from "./configuration";
import { TableNames } from "../appserver/src/config/dynamoTables";

export interface EventsStackProps extends cdk.StackProps {
  deploymentEnv: string;
}

export class EventsStack extends cdk.Stack {
  public readonly eventsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);

    // Get environment-specific settings
    const isProd = props.deploymentEnv === "production";
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Events table
    this.eventsTable = new dynamodb.Table(this, `${APP_NAME}-EventsTable`, {
      tableName: `${TableNames.EVENTS}-${props.deploymentEnv}`,
      partitionKey: {
        name: 'eventId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: isProd,
      removalPolicy: removalPolicy,
      stream: isProd ? dynamodb.StreamViewType.NEW_AND_OLD_IMAGES : undefined
    });

    //  querying events by user
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'userId-timestamp-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.NUMBER
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    //  querying events by type
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'eventType-timestamp-index',
      partitionKey: {
        name: 'eventType',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // querying events by category
    this.eventsTable.addGlobalSecondaryIndex({
      indexName: 'category-timestamp-index',
      partitionKey: {
        name: 'category',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    new cdk.CfnOutput(this, 'EventsTableName', {
      value: this.eventsTable.tableName,
      description: 'DynamoDB Events Table Name',
      exportName: `${APP_NAME}-${props.deploymentEnv}-EventsTableName`,
    });

    cdk.Tags.of(this).add('Component', 'EventStore');
    cdk.Tags.of(this).add('Environment', props.deploymentEnv);
  }
}
