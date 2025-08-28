import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { APP_NAME, HOSTED_ZONE_NAME } from "./configuration";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { IVpc, ISecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import { SSMParameterWrapper } from "./createSSMParameters";

/**
 * Properties for configuring the Fargate cluster.
 */
export interface AppClusterProps {
  /** The application environment (e.g., 'dev', 'prod'). */
  appEnv: string;
  /** The desired number of ECS tasks. */
  desiredCount: number;
  /** The Route 53 hosted zone for the application. */
  hostedZone: IHostedZone;
  /** The SSL certificate for the load balancer. */
  certificate: cdk.aws_certificatemanager.Certificate;
  /** The maximum number of ECS tasks. */
  maxCapacity: number;
  /** The subdomain for the application. */
  subDomain: string;
  /** The IAM policy statement for the execution role. */
  executionRolePolicy: iam.PolicyStatement;
  /** The IAM policy statements for the task role. */
  taskRolePolicies: iam.PolicyStatement[];
  /** The VPC where the Fargate cluster will be deployed. */
  vpc: IVpc;
  /** The SSM parameters to be used as environment variables. */
  ssmParameters: {
    [key: string]: SSMParameterWrapper;
  };
  /** Security groups to assign to the Fargate tasks */
  securityGroups?: ISecurityGroup[];
  /** Optional subnet type for the Fargate tasks (defaults to PRIVATE_WITH_NAT) */
  taskSubnetType?: SubnetType;
}

/**
 * A construct that creates a configured Fargate service with an Application Load Balancer.
 */
export class ConfiguredFargateGateway extends Construct {
  private props: AppClusterProps;
  /** The Fargate service. */
  public fargateService: ApplicationLoadBalancedFargateService;
  /** The URL of the service. */
  public serviceUrl: string;
  /** The ECS cluster. */
  public readonly cluster: Cluster;

  /**
   * Creates a new instance of ConfiguredFargateGateway.
   *
   * @param scope The scope in which to define this construct.
   * @param id The scoped construct ID.
   * @param props The properties for configuring the cluster and service.
   */
  constructor(scope: Construct, id: string, props: AppClusterProps) {
    super(scope, id);
    this.props = props;

    /**
     * Create the ECS cluster.
     */
    this.cluster = new ecs.Cluster(this, `Cluster-${props.appEnv}`, {
      clusterName: `${APP_NAME}-${props.appEnv}`,
      vpc: props.vpc,
    });

    /**
     * Prepare environment variables for the Fargate task.
     */
    const environmentVariables: { [key: string]: string } = {
      GIT_TAGS: process.env.GIT_TAGS || "latest",
    };

    // Map SSM parameters to environment variables
    Object.entries(props.ssmParameters).forEach(([key, param]) => {
      environmentVariables[key.toUpperCase()] = param.parameter.stringValue;
    });

    /**
     * Create the Fargate service with an Application Load Balancer.
     */
    this.fargateService = new ApplicationLoadBalancedFargateService(
      this,
      `Service-${this.props.appEnv}`,
      {
        cluster: this.cluster,
        listenerPort: 443,
        memoryLimitMiB: 2048,
        desiredCount: props.desiredCount,
        cpu: 1024,
        taskImageOptions: {
          containerPort: 3000,
          image: ecs.ContainerImage.fromEcrRepository(
            ecr.Repository.fromRepositoryName(
              this,
              "337654367097.dkr.ecr.us-east-1.amazonaws.com/stagely-api:latest",
              `stagely-api`
            ),
            "latest"
          ),
          environment: environmentVariables,
        },
        loadBalancerName: `${APP_NAME}-ALB-${props.appEnv}`,
        healthCheckGracePeriod: Duration.seconds(180),
        publicLoadBalancer: true,
        redirectHTTP: true,
        domainZone: props.hostedZone,
        domainName: `${props.subDomain}.${HOSTED_ZONE_NAME}`,
        certificate: props.certificate,
        serviceName: `${APP_NAME}-${props.appEnv}`,
        securityGroups: props.securityGroups, // Use the provided security groups
        taskSubnets: {
          subnetType: props.taskSubnetType || ec2.SubnetType.PRIVATE_WITH_NAT,
        },
      }
    );

    this.fargateService.targetGroup.configureHealthCheck({
      path: "/health",
      timeout: Duration.seconds(5),
      interval: Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      healthyHttpCodes: "200-299",
    });

    /**
     * Set the service URL and create a CloudFormation output.
     */
    this.serviceUrl =
      "https://" + this.fargateService.loadBalancer.loadBalancerDnsName;
    new cdk.CfnOutput(this, `ALB-URL-${props.appEnv}`, {
      value: this.serviceUrl,
    });

    /**
     * Set connection draining timeout to 5 seconds.
     */
    this.fargateService.targetGroup.setAttribute(
      "deregistration_delay.timeout_seconds",
      "5"
    );

    /**
     * Add IAM policies to the task execution role and task role.
     */
    this.fargateService.taskDefinition.addToExecutionRolePolicy(
      props.executionRolePolicy
    );
    props.taskRolePolicies.forEach((iamPolicy) => {
      this.fargateService.taskDefinition.addToTaskRolePolicy(iamPolicy);
    });

    // Uncomment for auto-scaling
    // const scalableTarget = this.fargateService.service.autoScaleTaskCount({
    //   minCapacity: props.desiredCount,
    //   maxCapacity: props.maxCapacity,
    // });

    // scalableTarget.scaleOnCpuUtilization("CpuScaling", {
    //   targetUtilizationPercent: 51,
    // });

    // scalableTarget.scaleOnMemoryUtilization("MemoryScaling", {
    //   targetUtilizationPercent: 51,
    // });
  }
}
