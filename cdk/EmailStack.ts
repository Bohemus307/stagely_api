// src/cdk/EmailStack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ses from "aws-cdk-lib/aws-ses";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import { APP_NAME } from "./configuration";
import { AppEnvironment } from "./ComputeStack";
import createSSMParameters from "./createSSMParameters";

export interface EmailStackProps extends cdk.StackProps {
  deploymentEnv: string;
  domain: string;
  hostedZoneId: string;
}

export class EmailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    // Import the hosted zone
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      `${APP_NAME}-hosted-zone`,
      {
        zoneName: props.domain,
        hostedZoneId: props.hostedZoneId,
      }
    );

    // Create an IAM role for sending emails
    const sesRole = new iam.Role(this, `${APP_NAME}-SESRole`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `Role for sending emails via SES for ${APP_NAME}`,
    });

    // Add SES permissions to the role
    sesRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
        effect: iam.Effect.ALLOW,
      })
    );

    // Add SES template management permissions
    sesRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ses:CreateTemplate",
          "ses:UpdateTemplate",
          "ses:DeleteTemplate",
          "ses:GetTemplate",
          "ses:ListTemplates",
        ],
        resources: ["*"],
        effect: iam.Effect.ALLOW,
      })
    );

    // Create a new domain identity in SES
    const identity = new ses.EmailIdentity(this, `${APP_NAME}-email-identity`, {
      identity: ses.Identity.domain(props.domain),
      dkimSigning: true,
      mailFromDomain: `mail.${props.domain}`,
    });

    // Define SSM parameters for email configuration
    const emailSsmParamsConfig = () => {
      const appEnv = props.deploymentEnv as AppEnvironment;
      return [
        {
          name: `/email/from-address-${appEnv}`,
          envKey: "SES_FROM_ADDRESS",
          description: `Default from email address for ${appEnv}`,
          environments: {
            [appEnv]: `no-reply@${props.domain}`,
          },
        },
        {
          name: `/email/reply-to-address-${appEnv}`,
          envKey: "SES_REPLY_TO_ADDRESS",
          description: `Default reply-to email address for ${appEnv}`,
          environments: {
            [appEnv]: `support@${props.domain}`,
          },
        },
        {
          name: `/email/ses-region-${appEnv}`,
          envKey: "SES_REGION",
          description: `AWS region for SES service for ${appEnv}`,
          environments: {
            [appEnv]: this.region,
          },
        },
      ];
    };

    // Create SSM parameters
    const emailSsmParams = createSSMParameters(
      this,
      emailSsmParamsConfig(),
      props.deploymentEnv as AppEnvironment
    );

    // Output the role ARN for reference
    new cdk.CfnOutput(this, "SESRoleArn", {
      value: sesRole.roleArn,
      description: "IAM Role ARN for SES access",
      exportName: `${APP_NAME}-${props.deploymentEnv}-SESRoleArn`,
    });

    // Output the domain identity ARN
    new cdk.CfnOutput(this, "SESDomainIdentityArn", {
      value: identity.emailIdentityName,
      description: "ARN of the SES Domain Identity",
      exportName: `${APP_NAME}-${props.deploymentEnv}-SESDomainIdentityArn`,
    });
  }
}
