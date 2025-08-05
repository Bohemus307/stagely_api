#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ComputeStack } from "../cdk/ComputeStack";
import {
  APP_NAME,
  RESOURCE_DEPLOYMENT_REGION,
  ACCOUNT_ID,
  HOSTED_ZONE_NAME,
  DB_VPC_ID,
} from "../cdk/configuration";
import StaticObjectStorageStack from "../cdk/StaticObjectStorageStack";
import { DataStack } from "../cdk/DataStack";
import { MessagingStack } from '../cdk/MessagingStack';
import { EmailStack } from '../cdk/EmailStack';
import { EventsStack } from '../cdk/EventsStack';
import { WebSocketStack } from '../cdk/webSocketStack';

const app = new cdk.App();

// Define deployment environment
const deploymentEnv = "staging";

const dataStack = new DataStack(app, `${APP_NAME}-DataStack`, {
  deploymentEnv: deploymentEnv,
  env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION }
});

const computeStack =

new ComputeStack(app, `${APP_NAME}-Infrastructure`, {
  vpcId: DB_VPC_ID,
  env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION },
});

// Create the new MessagingStack
const messagingStack = new MessagingStack(app, `${APP_NAME}-Messaging`, {
  deploymentEnv: deploymentEnv,
  env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION }
});

const emailStack = new EmailStack(app, `${APP_NAME}-Email`, {
  deploymentEnv: deploymentEnv,
  domain: HOSTED_ZONE_NAME,
  hostedZoneId: HOSTED_ZONE_NAME,
  env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION }
});

const eventsStack = new EventsStack(app, `${APP_NAME}-Events`, {
  deploymentEnv: deploymentEnv,
  env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION }
});

const webSocketStack = new WebSocketStack(app, `${APP_NAME}-WebSocket`, {
  deploymentEnv: deploymentEnv,
  connectionsTable: messagingStack.connectionsTable,
  eventsTable: eventsStack.eventsTable,
  auth0Domain: 'placeholder.auth0.com', // ✅ Temporary placeholder
  env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION }
});

// Add dependencies to ensure correct deployment order
computeStack.addDependency(dataStack);
webSocketStack.addDependency(messagingStack);
webSocketStack.addDependency(eventsStack);

new StaticObjectStorageStack(app, `${APP_NAME}-StaticAssets`, {
  env: { account: ACCOUNT_ID, region: "us-east-1" },
  hostedZoneName: HOSTED_ZONE_NAME,
  domainPrefix: "assets",
  bucketName: `${APP_NAME.toLowerCase()}-static-assets-bucket-${ACCOUNT_ID}`,
});
