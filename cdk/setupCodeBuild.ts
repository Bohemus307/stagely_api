import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { APP_NAME } from "./configuration";

export default function setupEcrAndCodeBuild(
  stack: cdk.Stack,
  stagingCluster: ecs.Cluster,
  prodCluster: ecs.Cluster
) {
  const ecrRepo = new ecr.Repository(stack, "EcrRepo");

  // CodeBuild project with environment variables included directly
  const codebuildProject = new codebuild.Project(stack, `${APP_NAME}`, {
    projectName: `${stack.stackName}`,
    environment: {
      buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
    },
    environmentVariables: {
      ECR_REPO_URI: {
        value: `${ecrRepo.repositoryUri}`,
      },
      // Add SSM paths here directly in the environmentVariables property
      STAGING_ENV_PATH: {
        value: `/${APP_NAME}/staging`,
      },
      PROD_ENV_PATH: {
        value: `/${APP_NAME}/prod`,
      },
    },
    buildSpec: codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        pre_build: {
          commands: [
            "env",
            "export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}",
            // Add commands to load params from SSM if needed in the build
            "# Load environment variables from SSM for the appropriate environment",
            'if [ "$DEPLOYMENT_ENV" = "prod" ]; then',
            "  export ENV_PATH=$PROD_ENV_PATH",
            "else",
            "  export ENV_PATH=$STAGING_ENV_PATH",
            "fi",
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
            `printf '[{\"name\":\"web\",\"imageUri\":\"%s\"}]' $ECR_REPO_URI:$TAG > imagedefinitions.json`,
            "pwd; ls -al; cat imagedefinitions.json",
          ],
        },
      },
      artifacts: {
        files: ["imagedefinitions.json"],
      },
    }),
  });

  // Grant permissions
  ecrRepo.grantPullPush(codebuildProject.role!);

  // Add permissions for ECS clusters
  codebuildProject.addToRolePolicy(
    new iam.PolicyStatement({
      actions: [
        "ecs:DescribeCluster",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ],
      resources: [`${stagingCluster.clusterArn}`, `${prodCluster.clusterArn}`],
    })
  );

  // Add SSM permissions
  codebuildProject.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
      ],
      resources: [
        `arn:aws:ssm:${stack.region}:${stack.account}:parameter/${APP_NAME}/staging/*`,
        `arn:aws:ssm:${stack.region}:${stack.account}:parameter/${APP_NAME}/prod/*`,
      ],
    })
  );

  return {
    ecrRepo,
    codebuildProject,
  };
}
