import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import { APP_NAME } from "./configuration";

export interface DataStackProps extends cdk.StackProps {
  deploymentEnv: string;
}

export class DataStack extends cdk.Stack {
  static vpc: ec2.Vpc;
  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // Use existing VPC or create a new one
    const vpc = new ec2.Vpc(this, `${APP_NAME}-vpc-${props.deploymentEnv}`, {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create security group for database
    const dbSecurityGroup = new ec2.SecurityGroup(this, "DbSecurityGroup", {
      vpc,
      description: `Security group for ${APP_NAME} database`,
      allowAllOutbound: true,
    });

    // Allow connections from the same VPC initially
    // You can update this manually later to restrict it
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      "Allow PostgreSQL access from VPC"
    );

    // Create database
    const dbName = `${APP_NAME.replace(/-/g, "_")}_${props.deploymentEnv}`;

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        props.deploymentEnv === "production"
          ? ec2.InstanceSize.MEDIUM
          : ec2.InstanceSize.SMALL
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
      securityGroups: [dbSecurityGroup],
      allocatedStorage: props.deploymentEnv === "production" ? 50 : 20,
      maxAllocatedStorage: props.deploymentEnv === "production" ? 200 : 50,
      databaseName: dbName,
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      backupRetention:
        props.deploymentEnv === "production"
          ? cdk.Duration.days(7)
          : cdk.Duration.days(1),
      deletionProtection: props.deploymentEnv === "production",
      multiAz: props.deploymentEnv === "production",
      publiclyAccessible: false,
    });

    // Output the database URL format (but without credentials)
    new cdk.CfnOutput(this, "DatabaseURLFormat", {
      value: `postgresql://USERNAME:PASSWORD@${database.dbInstanceEndpointAddress}:${database.dbInstanceEndpointPort}/${dbName}`,
      description: "Database URL format (replace USERNAME and PASSWORD)",
    });

    // Output info to make manual configuration easier
    new cdk.CfnOutput(this, "DbEndpoint", {
      value: database.dbInstanceEndpointAddress,
      description: "Database endpoint address",
    });

    new cdk.CfnOutput(this, "DbPort", {
      value: database.dbInstanceEndpointPort,
      description: "Database port",
    });

    new cdk.CfnOutput(this, "DbSecurityGroupId", {
      value: dbSecurityGroup.securityGroupId,
      description: "Database security group ID",
    });

    new cdk.CfnOutput(this, "DbSecretArn", {
      value: database.secret?.secretArn || "",
      description: "Database credentials secret ARN",
    });

    new cdk.CfnOutput(this, "VpcId", {
      value: vpc.vpcId,
      description: "VPC ID",
    });
  }
}