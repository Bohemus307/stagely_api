import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ecs from "aws-cdk-lib/aws-ecs";

export interface PostgresRdsProps {
  cluster: ecs.Cluster;
  deploymentEnv: string;
  appName: string;
  allocatedStorage?: number;
  maxAllocatedStorage?: number;
  instanceType?: ec2.InstanceType;
  databaseName?: string;
  backupRetention?: cdk.Duration;
  deletionProtection?: boolean;
  fargateService?: ecs.FargateService;
  vpcSubnets?: ec2.SubnetSelection;
}

export class PostgresRdsDatabase extends Construct {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: PostgresRdsProps) {
    super(scope, id);

    // Default values
    const dbName =
      props.databaseName ||
      `${props.appName.replace(/-/g, "_")}_${props.deploymentEnv}`;
    const instanceType =
      props.instanceType ||
      ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        props.deploymentEnv === "prod"
          ? ec2.InstanceSize.MEDIUM
          : ec2.InstanceSize.SMALL
      );

    // Get VPC from the ECS cluster
    const vpc = props.cluster.vpc;

    // Create security group for database
    const dbSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        vpc,
        description: `Security group for ${props.appName} PostgreSQL in ${props.deploymentEnv}`,
        allowAllOutbound: true,
      }
    );

    // If Fargate service is provided, allow it to connect to Postgres
    if (props.fargateService) {
      const fargateSecurityGroups =
        props.fargateService.connections.securityGroups;
      fargateSecurityGroups.forEach((sg) => {
        dbSecurityGroup.addIngressRule(
          ec2.Peer.securityGroupId(sg.securityGroupId),
          ec2.Port.tcp(5432),
          "Allow access from Fargate service"
        );
      });
    }

    // Create credentials in Secrets Manager
    this.dbSecret = new secretsmanager.Secret(this, "DbCredentials", {
      secretName: `${props.appName}/${props.deploymentEnv}/db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: `${props.appName.replace(/-/g, "_")}_${
            props.deploymentEnv
          }_user`, // Create app-specific username
          dbname: dbName,
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: "password",
      },
    });

    // Create the RDS instance
    this.dbInstance = new rds.DatabaseInstance(this, "Instance", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      instanceType: instanceType,
      vpc: vpc,
      vpcSubnets: props.vpcSubnets || {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      allocatedStorage: props.allocatedStorage || 20,
      maxAllocatedStorage: props.maxAllocatedStorage || 100,
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      databaseName: dbName,
      backupRetention:
        props.backupRetention ||
        cdk.Duration.days(props.deploymentEnv === "prod" ? 7 : 1),
      deletionProtection:
        props.deletionProtection !== undefined
          ? props.deletionProtection
          : props.deploymentEnv === "prod",
      parameterGroup: new rds.ParameterGroup(this, "ParameterGroup", {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_14,
        }),
        parameters: {
          max_connections: props.deploymentEnv === "prod" ? "100" : "50",
        },
      }),
      publiclyAccessible: false,
      multiAz: props.deploymentEnv === "prod",
      storageEncrypted: true,
    });

    // Output the database endpoint, port, and name
    new cdk.CfnOutput(this, "DbEndpoint", {
      value: this.dbInstance.dbInstanceEndpointAddress,
      description: "Database endpoint",
    });

    new cdk.CfnOutput(this, "DbPort", {
      value: this.dbInstance.dbInstanceEndpointPort,
      description: "Database port",
    });

    new cdk.CfnOutput(this, "DbName", {
      value: dbName,
      description: "Database name",
    });

    new cdk.CfnOutput(this, "DbSecretArn", {
      value: this.dbSecret.secretArn,
      description: "Database credentials secret ARN",
    });

    // Output the Prisma connection string format (without the actual password)
    new cdk.CfnOutput(this, "PrismaConnectionStringFormat", {
      value: `postgresql://\${Token[AWS.SecretsManager.SecretString::${this.dbSecret.secretArn}:username]}:PASSWORD@${this.dbInstance.dbInstanceEndpointAddress}:${this.dbInstance.dbInstanceEndpointPort}/\${Token[AWS.SecretsManager.SecretString::${this.dbSecret.secretArn}:dbname]}?schema=public`,
      description:
        "Prisma connection string format (replace PASSWORD with actual password from Secrets Manager)",
    });
  }
}
