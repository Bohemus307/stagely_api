#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ComputeStack } from '../cdk/ComputeStack';
import { APP_NAME, RESOURCE_DEPLOYMENT_REGION, ACCOUNT_ID, HOSTED_ZONE_NAME } from "../cdk/configuration";
import StaticObjectStorageStack from "../cdk/StaticObjectStorageStack";
import { DataStack } from '../cdk/DataStack';

const app = new cdk.App();

const dataStack = new DataStack(app, `${APP_NAME}-DataStack`, { deploymentEnv: "staging", env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION }
});

const computeStack = new ComputeStack(app, `${APP_NAME}-Infrastructure`, {
  vpc: DataStack.vpc, 
  env: { account: ACCOUNT_ID, region: RESOURCE_DEPLOYMENT_REGION },
});

// Add dependency to ensure correct deployment order
computeStack.addDependency(dataStack);

new StaticObjectStorageStack(app, `${APP_NAME}-StaticAssets`, {
  env: { account: ACCOUNT_ID, region: 'us-east-1' },
  hostedZoneName: HOSTED_ZONE_NAME,
  domainPrefix: 'assets',
  bucketName: `${APP_NAME.toLowerCase()}-static-assets-bucket-${ACCOUNT_ID}`
});
