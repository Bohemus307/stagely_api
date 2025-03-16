import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { ConfiguredFargateGateway } from "./ConfiguredFargateLoadBalancedApplicationWithSSL";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { aws_certificatemanager as acm } from "aws-cdk-lib";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import setupCodeBuild from "./setupCodeBuild";
import setupPipeline from "./setupPipeline";

import {
  APP_NAME,
  CODESTAR_CONNECTION_ARN,
  GH_REPO_NAME,
  HOSTED_ZONE_ID,
  HOSTED_ZONE_NAME,
  STAGING_SUBDOMAIN,
  taskExecutionIamPoliciesJSON,
} from "./configuration";
import createSSMParameters from "./createSSMParameters";

/**
 * Enum representing different application environments.
 */
export enum AppEnvironment {
  // eslint-disable-next-line no-unused-vars
  Develop = "develop",
  // eslint-disable-next-line no-unused-vars
  Staging = "staging",
  // eslint-disable-next-line no-unused-vars
  Production = "production",
}

// Add interface for ComputeStack props
export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const ssmParamsConfig = (appEnv: AppEnvironment) => {
      return [
        {
          name: `/sdk/aws-access-key-id-${appEnv}`,
          envKey: "ACCESS_KEY_ID",
          description: `aws access key for ${appEnv}`,
        },
        {
          name: `/sdk/aws-secret-access-key-id-${appEnv}`,
          envKey: "SECRET_ACCESS_KEY",
          description: `aws secret access key for ${appEnv}`,
        },
        {
          name: `/dockerhub/username-${appEnv}`,
          envKey: "DOCKERHUB_USERNAME",
          description: `DockerHub username for ${appEnv}`,
        },
        {
          name: `/dockerhub/access-token-${appEnv}`,
          envKey: "DOCKERHUB_PASSWORD",
          description: `DockerHub access token for ${appEnv}`,
        },
        {
          name: `/prisma/dburl-${appEnv}`,
          envKey: "DATABASE_URL",
          description: `prisma db url ${appEnv}`,
        },
        {
          name: `/s3/bucketname-${appEnv}`,
          envKey: "S3_BUCKET_NAME",
          description: `s3 bucket name for ${appEnv}`,
        },
      ];
    };

    // Create SSM parameters
    const ssmParamsStaging = createSSMParameters(
      this,
      ssmParamsConfig(AppEnvironment.Staging),
      AppEnvironment.Staging
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

    // Create an SSL certificate for the domains
    const certificate = new acm.Certificate(this, "ComputeStackCertificates", {
      domainName: `*.${HOSTED_ZONE_NAME}`,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Import the VPC created by the database stack
    // Use VPC from props or import it
    const vpc: ec2.IVpc = props.vpc;

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


    const taskRolePolicies = [
      ...taskExecutionIamPoliciesJSON.map(
        (policyJson) => new iam.PolicyStatement(policyJson)
      ),
    ];

    const fargateAppStaging = new ConfiguredFargateGateway(
      this,
      `${APP_NAME}-staging`,
      {
        appEnv: "staging",
        desiredCount: 1,
        hostedZone,
        certificate,
        maxCapacity: 1,
        subDomain: STAGING_SUBDOMAIN,
        executionRolePolicy,
        taskRolePolicies,
        vpc: vpc,
        ssmParameters: ssmParamsStaging,
      }
    );

    const codebuildGatewayStaging = setupCodeBuild(
      this,
      fargateAppStaging.cluster,
      AppEnvironment.Staging,
      ssmParamsStaging
    );

    setupPipeline(
      this,
      codebuildGatewayStaging.codebuildProject,
      fargateAppStaging.fargateService.service,
      CODESTAR_CONNECTION_ARN,
      APP_NAME,
      GH_REPO_NAME,
      AppEnvironment.Staging
    );
  }
}
