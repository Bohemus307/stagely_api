// src/cdk/EmailStack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ses from "aws-cdk-lib/aws-ses";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import { APP_NAME, HOSTED_ZONE_ID, HOSTED_ZONE_NAME } from "./configuration";


export interface EmailStackProps extends cdk.StackProps {
  deploymentEnv: string;
  domain: string;
  hostedZoneId: string;
}

export class EmailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      `${APP_NAME}-hosted-zone`,
      {
        zoneName: HOSTED_ZONE_NAME,
        hostedZoneId: HOSTED_ZONE_ID,
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

    // Define email configuration for this environment
    const fromAddress = `no-reply@${HOSTED_ZONE_NAME}`;
    const replyToAddress = `support@${HOSTED_ZONE_NAME}`;
    const sesRegion = this.region;

    // Export email configuration as CloudFormation outputs
    new cdk.CfnOutput(this, "FromEmailAddress", {
      value: fromAddress,
      description: "Default FROM email address",
      exportName: `${APP_NAME}-${props.deploymentEnv}-FromEmailAddress`,
    });

    new cdk.CfnOutput(this, "ReplyToEmailAddress", {
      value: replyToAddress,
      description: "Default REPLY-TO email address",
      exportName: `${APP_NAME}-${props.deploymentEnv}-ReplyToEmailAddress`,
    });

    new cdk.CfnOutput(this, "SESRegion", {
      value: sesRegion,
      description: "AWS region for SES service",
      exportName: `${APP_NAME}-${props.deploymentEnv}-SESRegion`,
    });

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
