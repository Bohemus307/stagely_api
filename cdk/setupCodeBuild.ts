import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";

import { APP_NAME } from "./configuration";
import { SSMParameterWrapper } from "./createSSMParameters";
import { AppEnvironment } from "./ComputeStack";

/**
 * Interface for the return value of setupEcrAndCodeBuild function.
 */
export interface EcrCodeBuildSetup {
  /** The created ECR repository. */
  ecrRepo: ecr.Repository;
  /** The created CodeBuild project. */
  codebuildProject: codebuild.Project;
}

/**
 * Sets up an ECR repository and a CodeBuild project.
 *
 * @param stack The CDK stack in which to define this construct.
 * @param developCluster The ECS cluster for the development environment.
 * @param stagingCluster The ECS cluster for the staging environment.
 * @param prodCluster The ECS cluster for the production environment.
 * @returns An object containing the ECR repository and CodeBuild project.
 */
export default function setupEcrAndCodeBuild(
  stack: cdk.Stack,
  cluster: ecs.Cluster,
  appEnv: AppEnvironment,
  ssmParams: {
    [key: string]: SSMParameterWrapper;
  }
): EcrCodeBuildSetup {
  // Create an ECR repository
  const ecrRepo = new ecr.Repository(stack, `EcrRepo-Gateway-${appEnv}`);

  // Create a CodeBuild project
  const codebuildProject = new codebuild.Project(
    stack,
    `${APP_NAME}-CODEBUILD-PROJECT-${appEnv}`,
    {
      projectName: `${APP_NAME}-CODEBUILD-${appEnv}`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        // Map SSM parameters to environment variables
        ...Object.fromEntries(
          Object.entries(ssmParams).map(([name, param]) => [
            name.split("/").pop()!.toUpperCase(),
            {
              type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
              value: param.parameter.parameterName,
            },
          ])
        ),
        DOCKER_BUILDKIT: { value: "1" },
        ECR_REPO_URI: {
          value: `${ecrRepo.repositoryUri}`,
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "env",
              "export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}",
            ],
          },
          build: {
            commands: [
              "docker login --username $DOCKERHUB_USERNAME --password $DOCKERHUB_PASSWORD",
              "cd appserver",
              "docker build -t $ECR_REPO_URI:$TAG --platform linux/amd64 .",
              "$(aws ecr get-login --no-include-email)",
              "docker push $ECR_REPO_URI:$TAG",
            ],
          },
          post_build: {
            commands: [
              'echo "In Post-Build Stage"',
              "cd ..",
              // default container name is "web"
              `printf '[{"name":"web","imageUri":"%s"}]' $ECR_REPO_URI:$TAG > imagedefinitions.json`,
              "pwd; ls -al; cat imagedefinitions.json",
            ],
          },
        },
        artifacts: {
          files: ["imagedefinitions.json"],
        },
      }),
    }
  );

  // Grant the CodeBuild project permissions to pull and push images to the ECR repository
  ecrRepo.grantPullPush(codebuildProject.role!);

  // Add IAM policies to the CodeBuild project's role
  codebuildProject.addToRolePolicy(
    new iam.PolicyStatement({
      actions: [
        "ecs:DescribeCluster",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:GetRepositoryPolicy",
        "ecr:DescribeRepositories",
        "ecr:ListImages",
        "ecr:DescribeImages",
        "ecr:GetLifecyclePolicy",
        "ecr:GetLifecyclePolicyPreview",
        "ecr:ListTagsForResource",
        "ecr:DescribeImageScanFindings",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
      ],
      resources: [`${cluster.clusterArn}`],
    })
  );

  // Grant permissions to access SSM parameters
  codebuildProject.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: Object.values(ssmParams).map((param) => param.parameterArn),
    })
  );

  return {
    ecrRepo,
    codebuildProject,
  };
}
