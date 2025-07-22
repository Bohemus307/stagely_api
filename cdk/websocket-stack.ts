import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class WebSocketStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Lambda functions
        const connectFunction = new Function(this, 'WebSocketConnectFunction', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'websocket-connect.handler',
            code: Code.fromAsset('dist/lambda'),
            environment: {
                CONNECTIONS_TABLE: 'stagely-connections-production'
            }
        });

        const disconnectFunction = new Function(this, 'WebSocketDisconnectFunction', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'websocket-disconnect.handler',
            code: Code.fromAsset('dist/lambda')
        });

        const messageFunction = new Function(this, 'WebSocketMessageFunction', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'websocket-message.handler',
            code: Code.fromAsset('dist/lambda')
        });

        // WebSocket API
        const webSocketApi = new WebSocketApi(this, 'WebSocketApi', {
            connectRouteOptions: {
                integration: new WebSocketLambdaIntegration('ConnectIntegration', connectFunction)
            },
            disconnectRouteOptions: {
                integration: new WebSocketLambdaIntegration('DisconnectIntegration', disconnectFunction)
            },
            defaultRouteOptions: {
                integration: new WebSocketLambdaIntegration('MessageIntegration', messageFunction)
            }
        });

        // WebSocket Stage
        const stage = new WebSocketStage(this, 'WebSocketStage', {
            webSocketApi,
            stageName: 'production',
            autoDeploy: true
        });

        // DynamoDB Stream Processor
        const streamProcessor = new Function(this, 'DynamoDBStreamProcessor', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'dynamodb-stream-processor.handler',
            code: Code.fromAsset('dist/lambda'),
            environment: {
                WEBSOCKET_API_ENDPOINT: stage.callbackUrl
            }
        });

        // Connect DynamoDB streams to processor
        const eventsTable = Table.fromTableName(this, 'EventsTable', 'stagely-events-production');
        streamProcessor.addEventSource(new DynamoEventSource(eventsTable, {
            startingPosition: StartingPosition.LATEST,
            batchSize: 10,
            parallelizationFactor: 1
        }));

        // Grant permissions
        eventsTable.grantStreamRead(streamProcessor);
        webSocketApi.grantManageConnections(streamProcessor);
    }
}
