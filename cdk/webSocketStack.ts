// cdk/webSocketStack.ts - No Docker required version
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { APP_NAME } from './configuration';

export interface WebSocketStackProps extends cdk.StackProps {
  deploymentEnv: string;
  connectionsTable: dynamodb.Table;
  eventsTable: dynamodb.Table;
  auth0Domain?: string; // Made optional
}

export class WebSocketStack extends cdk.Stack {
  public readonly webSocketApiId: string;
  public readonly webSocketUrl: string;
  public readonly connectFunction: lambda.Function;
  public readonly disconnectFunction: lambda.Function;
  public readonly messageFunction: lambda.Function;
  public readonly streamProcessorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    const isProd = props.deploymentEnv === 'production';

    // =============================
    // Dead Letter Queue for Stream Processing
    // =============================
    const streamProcessorDLQ = new sqs.Queue(this, 'StreamProcessorDLQ', {
      queueName: `${APP_NAME}-websocket-stream-dlq-${props.deploymentEnv}`,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.minutes(6),
    });

    // =============================
    // Lambda Functions - Using inline code (no Docker needed)
    // =============================

    // Shared Lambda environment variables
    const sharedEnvironment = {
      NODE_ENV: props.deploymentEnv,
      // AWS_REGION is automatically provided by Lambda runtime - don't set it manually
      CONNECTIONS_TABLE: props.connectionsTable.tableName,
      EVENTS_TABLE: props.eventsTable.tableName,
      DATABASE_URL: process.env.DATABASE_URL || '',
      AUTH0_DOMAIN: props.auth0Domain || 'placeholder.auth0.com',
    };

    // WebSocket Connect Function
    this.connectFunction = new lambda.Function(this, 'ConnectFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: sharedEnvironment,
      functionName: `${APP_NAME}-websocket-connect-${props.deploymentEnv}`,
      code: lambda.Code.fromInline(`
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
        const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

        const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
        const documentClient = DynamoDBDocumentClient.from(dynamoClient);

        exports.handler = async (event) => {
          console.log('Connect event:', JSON.stringify(event, null, 2));

          try {
            const connectionId = event.requestContext.connectionId;
            const token = event.queryStringParameters?.token;

            if (!token) {
              return { statusCode: 401, body: 'No token provided' };
            }

            // Simple connection storage for now
            const now = Math.floor(Date.now() / 1000);
            const connection = {
              connectionId,
              userId: 1, // Placeholder - will implement Auth0 validation later
              timestamp: now * 1000,
              ttl: now + 24 * 60 * 60
            };

            await documentClient.send(new PutCommand({
              TableName: process.env.CONNECTIONS_TABLE,
              Item: connection
            }));

            return {
              statusCode: 200,
              body: JSON.stringify({ message: 'Connected successfully', connectionId })
            };
          } catch (error) {
            console.error('Connection error:', error);
            return { statusCode: 500, body: 'Connection failed' };
          }
        };
      `),
      handler: 'index.handler',
      description: 'Handles WebSocket connections',
      logRetention: isProd ? logs.RetentionDays.ONE_WEEK : logs.RetentionDays.THREE_DAYS,
    });

    // WebSocket Disconnect Function
    this.disconnectFunction = new lambda.Function(this, 'DisconnectFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: sharedEnvironment,
      functionName: `${APP_NAME}-websocket-disconnect-${props.deploymentEnv}`,
      code: lambda.Code.fromInline(`
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
        const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

        const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
        const documentClient = DynamoDBDocumentClient.from(dynamoClient);

        exports.handler = async (event) => {
          console.log('Disconnect event:', JSON.stringify(event, null, 2));

          try {
            const connectionId = event.requestContext.connectionId;

            await documentClient.send(new DeleteCommand({
              TableName: process.env.CONNECTIONS_TABLE,
              Key: { connectionId }
            }));

            return {
              statusCode: 200,
              body: JSON.stringify({ message: 'Disconnected successfully' })
            };
          } catch (error) {
            console.error('Disconnect error:', error);
            return { statusCode: 500, body: 'Disconnection failed' };
          }
        };
      `),
      handler: 'index.handler',
      description: 'Handles WebSocket disconnections',
      logRetention: isProd ? logs.RetentionDays.ONE_WEEK : logs.RetentionDays.THREE_DAYS,
    });

    // WebSocket Message Function
    this.messageFunction = new lambda.Function(this, 'MessageFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: sharedEnvironment,
      functionName: `${APP_NAME}-websocket-message-${props.deploymentEnv}`,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Message event:', JSON.stringify(event, null, 2));

          try {
            const connectionId = event.requestContext.connectionId;
            const body = JSON.parse(event.body || '{}');

            // Handle ping/pong
            if (body.type === 'ping') {
              return {
                statusCode: 200,
                body: JSON.stringify({
                  type: 'pong',
                  timestamp: Date.now(),
                  connectionId
                })
              };
            }

            return {
              statusCode: 200,
              body: JSON.stringify({
                message: 'Message received',
                type: body.type,
                timestamp: Date.now()
              })
            };
          } catch (error) {
            console.error('Message error:', error);
            return { statusCode: 500, body: 'Message handling failed' };
          }
        };
      `),
      handler: 'index.handler',
      description: 'Handles WebSocket messages',
      logRetention: isProd ? logs.RetentionDays.ONE_WEEK : logs.RetentionDays.THREE_DAYS,
    });

    // DynamoDB Stream Processor Function
    this.streamProcessorFunction = new lambda.Function(this, 'StreamProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: sharedEnvironment,
      functionName: `${APP_NAME}-websocket-stream-processor-${props.deploymentEnv}`,
      code: lambda.Code.fromInline(`
        const { unmarshall } = require('@aws-sdk/util-dynamodb');

        exports.handler = async (event) => {
          console.log('Stream event:', JSON.stringify(event, null, 2));

          for (const record of event.Records) {
            if (record.eventName === 'INSERT' && record.dynamodb?.NewImage) {
              try {
                const eventData = unmarshall(record.dynamodb.NewImage);
                console.log('Processing event:', eventData.eventType, 'for user', eventData.userId);

                // TODO: Broadcast to WebSocket connections
              } catch (error) {
                console.error('Error processing record:', error);
              }
            }
          }

          return { statusCode: 200 };
        };
      `),
      handler: 'index.handler',
      description: 'Processes DynamoDB streams and broadcasts WebSocket messages',
      logRetention: isProd ? logs.RetentionDays.ONE_WEEK : logs.RetentionDays.THREE_DAYS,
    });

    // =============================
    // WebSocket API Gateway (using raw CloudFormation)
    // =============================

    // Create WebSocket API using raw CloudFormation
    const webSocketApi = new cdk.CfnResource(this, 'WebSocketApi', {
      type: 'AWS::ApiGatewayV2::Api',
      properties: {
        Name: `${APP_NAME}-websocket-${props.deploymentEnv}`,
        Description: `WebSocket API for ${APP_NAME} real-time events`,
        ProtocolType: 'WEBSOCKET',
        RouteSelectionExpression: '$request.body.action',
      },
    });

    this.webSocketApiId = webSocketApi.ref;

    // Create Lambda permissions for API Gateway
    new cdk.CfnResource(this, 'ConnectPermission', {
      type: 'AWS::Lambda::Permission',
      properties: {
        FunctionName: this.connectFunction.functionName,
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApiId}/*/*`,
      },
    });

    new cdk.CfnResource(this, 'DisconnectPermission', {
      type: 'AWS::Lambda::Permission',
      properties: {
        FunctionName: this.disconnectFunction.functionName,
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApiId}/*/*`,
      },
    });

    new cdk.CfnResource(this, 'MessagePermission', {
      type: 'AWS::Lambda::Permission',
      properties: {
        FunctionName: this.messageFunction.functionName,
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApiId}/*/*`,
      },
    });

    // Create integrations
    const connectIntegration = new cdk.CfnResource(this, 'ConnectIntegration', {
      type: 'AWS::ApiGatewayV2::Integration',
      properties: {
        ApiId: this.webSocketApiId,
        IntegrationType: 'AWS_PROXY',
        IntegrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${this.connectFunction.functionArn}/invocations`,
      },
    });

    const disconnectIntegration = new cdk.CfnResource(this, 'DisconnectIntegration', {
      type: 'AWS::ApiGatewayV2::Integration',
      properties: {
        ApiId: this.webSocketApiId,
        IntegrationType: 'AWS_PROXY',
        IntegrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${this.disconnectFunction.functionArn}/invocations`,
      },
    });

    const messageIntegration = new cdk.CfnResource(this, 'MessageIntegration', {
      type: 'AWS::ApiGatewayV2::Integration',
      properties: {
        ApiId: this.webSocketApiId,
        IntegrationType: 'AWS_PROXY',
        IntegrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${this.messageFunction.functionArn}/invocations`,
      },
    });

    // Create routes
    new cdk.CfnResource(this, 'ConnectRoute', {
      type: 'AWS::ApiGatewayV2::Route',
      properties: {
        ApiId: this.webSocketApiId,
        RouteKey: '$connect',
        AuthorizationType: 'NONE',
        Target: `integrations/${connectIntegration.ref}`,
      },
    });

    new cdk.CfnResource(this, 'DisconnectRoute', {
      type: 'AWS::ApiGatewayV2::Route',
      properties: {
        ApiId: this.webSocketApiId,
        RouteKey: '$disconnect',
        AuthorizationType: 'NONE',
        Target: `integrations/${disconnectIntegration.ref}`,
      },
    });

    new cdk.CfnResource(this, 'DefaultRoute', {
      type: 'AWS::ApiGatewayV2::Route',
      properties: {
        ApiId: this.webSocketApiId,
        RouteKey: '$default',
        AuthorizationType: 'NONE',
        Target: `integrations/${messageIntegration.ref}`,
      },
    });

    // Create deployment
    const deployment = new cdk.CfnResource(this, 'WebSocketDeployment', {
      type: 'AWS::ApiGatewayV2::Deployment',
      properties: {
        ApiId: this.webSocketApiId,
      },
    });

    // Create stage
    const stage = new cdk.CfnResource(this, 'WebSocketStage', {
      type: 'AWS::ApiGatewayV2::Stage',
      properties: {
        ApiId: this.webSocketApiId,
        DeploymentId: deployment.ref,
        StageName: props.deploymentEnv,
      },
    });

    // Create WebSocket URL
    this.webSocketUrl = `wss://${this.webSocketApiId}.execute-api.${this.region}.amazonaws.com/${props.deploymentEnv}`;

    // =============================
    // DynamoDB Stream Integration
    // =============================

    // Add DynamoDB stream event source to the stream processor
    this.streamProcessorFunction.addEventSource(
      new DynamoEventSource(props.eventsTable as any, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: isProd ? 10 : 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
        parallelizationFactor: isProd ? 2 : 1,
        retryAttempts: 3,
      })
    );

    // Update stream processor environment with WebSocket endpoint
    this.streamProcessorFunction.addEnvironment('WEBSOCKET_API_ENDPOINT', this.webSocketUrl);

    // =============================
    // Permissions - Simplified approach
    // =============================

    // Create a comprehensive policy for all Lambda functions
    const dynamoPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:PutItem',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:DescribeStream',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:ListStreams'
      ],
      resources: [
        props.connectionsTable.tableArn,
        props.eventsTable.tableArn,
        `${props.eventsTable.tableArn}/stream/*`
      ]
    });

    // WebSocket API management permissions
    const websocketPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApiId}/*/*`],
    });

    // CloudWatch Logs permissions
    const logsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
    });

    // Add policies to each function
    [this.connectFunction, this.disconnectFunction, this.messageFunction].forEach(func => {
      func.addToRolePolicy(dynamoPolicy);
      func.addToRolePolicy(logsPolicy);
    });

    // Stream processor needs additional permissions
    this.streamProcessorFunction.addToRolePolicy(dynamoPolicy);
    this.streamProcessorFunction.addToRolePolicy(websocketPolicy);
    this.streamProcessorFunction.addToRolePolicy(logsPolicy);

    // =============================
    // Outputs
    // =============================

    new cdk.CfnOutput(this, 'WebSocketApiId', {
      value: this.webSocketApiId,
      description: 'WebSocket API ID',
      exportName: `${APP_NAME}-${props.deploymentEnv}-WebSocketApiId`,
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: this.webSocketUrl,
      description: 'WebSocket URL for client connections',
      exportName: `${APP_NAME}-${props.deploymentEnv}-WebSocketUrl`,
    });

    // =============================
    // Tags
    // =============================

    cdk.Tags.of(this).add('Component', 'WebSocket');
    cdk.Tags.of(this).add('Environment', props.deploymentEnv);
    cdk.Tags.of(this).add('Service', 'RealTimeNotifications');
  }
}
