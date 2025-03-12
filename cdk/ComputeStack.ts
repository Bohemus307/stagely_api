import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { ConfiguredFargateLoadBalancedApplicationWithSSL } from "./ConfiguredFargateLoadBalancedApplicationWithSSL";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import { DnsValidatedCertificate } from "aws-cdk-lib/aws-certificatemanager";

import setupCodeBuild from "./setupCodeBuild";
import setupPipeline from "./setupPipeline";
import { PostgresRdsDatabase } from "./PostgresRDSDatabase";

import {
  APP_NAME,
  HOSTED_ZONE_ID,
  HOSTED_ZONE_NAME,
  PROD_SUBDOMAIN,
  RESOURCE_DEPLOYMENT_REGION,
  STAGING_SUBDOMAIN,
  taskExecutionIamPoliciesJSON,
} from "./configuration";
import { createSSMParamsFromEnvFile } from "./createSSMParameters";

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create SSM parameters from env files - super simple approach
    createSSMParamsFromEnvFile(
      this,
      path.join(__dirname, "../.env"),
      APP_NAME,
      "staging"
    );

    createSSMParamsFromEnvFile(
      this,
      path.join(__dirname, "../.env"),
      APP_NAME,
      "prod"
    );

    // Rest of your existing code
    const hostedZone = HostedZone.fromHostedZoneAttributes(
      this,
      `cdkid-${HOSTED_ZONE_ID}`,
      {
        zoneName: HOSTED_ZONE_NAME,
        hostedZoneId: HOSTED_ZONE_ID,
      }
    );

    const certificate = new DnsValidatedCertificate(
      this,
      `${APP_NAME}-ACM-Certificate`,
      {
        domainName: `*.${HOSTED_ZONE_NAME}`,
        hostedZone: hostedZone,
        region: RESOURCE_DEPLOYMENT_REGION,
      }
    );

    // Create VPCs
    const stagingVpc = new ec2.Vpc(this, `${APP_NAME}-vpc-staging`, {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const prodVpc = new ec2.Vpc(this, `${APP_NAME}-vpc-prod`, {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const executionRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ],
    });

    const taskRolePolicies = taskExecutionIamPoliciesJSON.map(
      (policyJson) => new iam.PolicyStatement(policyJson)
    );

    // Add SSM Parameter Access Policy
    const stagingSSMAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
      ],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/${APP_NAME}/staging/*`,
      ],
    });

    const prodSSMAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
      ],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/${APP_NAME}/prod/*`,
      ],
    });

    // Create Fargate apps with custom VPCs
    const fargateAppStaging =
      new ConfiguredFargateLoadBalancedApplicationWithSSL(
        this,
        `${APP_NAME}-staging`,
        {
          appEnv: "",
          desiredCount: 1,
          deploymentEnv: "staging",
          hostedZone,
          certificate,
          maxCapacity: 1,
          subDomain: STAGING_SUBDOMAIN,
          executionRolePolicy,
          taskRolePolicies,
          vpc: stagingVpc,
        }
      );

    const fargateAppProd = new ConfiguredFargateLoadBalancedApplicationWithSSL(
      this,
      `${APP_NAME}-prod`,
      {
        appEnv: "",
        desiredCount: 1,
        deploymentEnv: "prod",
        hostedZone,
        certificate,
        maxCapacity: 2,
        subDomain: PROD_SUBDOMAIN,
        executionRolePolicy,
        taskRolePolicies,
        vpc: prodVpc,
      }
    );

    // Add SSM access to task roles
    fargateAppStaging.fargateService.taskDefinition.addToTaskRolePolicy(
      stagingSSMAccessPolicy
    );
    fargateAppProd.fargateService.taskDefinition.addToTaskRolePolicy(
      prodSSMAccessPolicy
    );

    // Add environment variable with path prefix so your app knows where to look
    fargateAppStaging.fargateService.taskDefinition.defaultContainer?.addEnvironment(
      "ENV_PATH",
      `/${APP_NAME}/staging`
    );

    fargateAppProd.fargateService.taskDefinition.defaultContainer?.addEnvironment(
      "ENV_PATH",
      `/${APP_NAME}/prod`
    );

    new PostgresRdsDatabase(
      this,
      `${APP_NAME}-pg-staging`,
      {
        cluster: fargateAppStaging.cluster,
        deploymentEnv: "staging",
        appName: APP_NAME,
        fargateService: fargateAppStaging.fargateService.service,
        allocatedStorage: 20,
        maxAllocatedStorage: 50,
        deletionProtection: false,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      }
    );

    new PostgresRdsDatabase(this, `${APP_NAME}-pg-prod`, {
      cluster: fargateAppProd.cluster,
      deploymentEnv: "prod",
      appName: APP_NAME,
      fargateService: fargateAppProd.fargateService.service,
      allocatedStorage: 50,
      maxAllocatedStorage: 200,
      deletionProtection: true,
      backupRetention: cdk.Duration.days(14),
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    const { codebuildProject } = setupCodeBuild(
      this,
      fargateAppStaging.cluster,
      fargateAppProd.cluster
    );

    // Add SSM access to CodeBuild
    codebuildProject.addToRolePolicy(stagingSSMAccessPolicy);
    codebuildProject.addToRolePolicy(prodSSMAccessPolicy);

    setupPipeline(
      this,
      codebuildProject,
      fargateAppStaging.fargateService.service,
      fargateAppProd.fargateService.service
    );
  }
}
