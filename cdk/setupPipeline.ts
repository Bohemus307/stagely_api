import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import { GH_USERNAME } from "./configuration";
import { FargateService } from "aws-cdk-lib/aws-ecs";
import { AppEnvironment } from "./ComputeStack";

/**
 * Sets up a CodePipeline for continuous integration and deployment.
 *
 * @param stack The CDK stack in which to define this construct.
 * @param project The CodeBuild project to use for the build stage.
 * @param fargateService The ECS Fargate service for the current environment.
 * @param codestarConnectionArn The Codestar connection arn for github etc..
 * @returns The created CodePipeline.
 */
export default function setupSingleEnvPipeline(
  stack: cdk.Stack,
  project: codebuild.Project,
  fargateService: FargateService,
  codestarConnectionArn: string,
  appName: string,
  githubRepoName: string,
  appEnv: AppEnvironment
) {
  // Define artifacts for the source and build outputs
  const sourceOutput = new codepipeline.Artifact();
  const buildOutput = new codepipeline.Artifact();

  // Define the source action using CodeStar Connections
  const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction(
    {
      actionName: "VCS_Source",
      output: sourceOutput,
      connectionArn: codestarConnectionArn,
      owner: GH_USERNAME,
      repo: githubRepoName,
      branch: appEnv === "production" ? "main" : appEnv,
    }
  );

  // Define the build action using CodeBuild
  const buildAction = new codepipeline_actions.CodeBuildAction({
    actionName: "CodeBuild",
    project: project,
    input: sourceOutput,
    outputs: [buildOutput],
  });

  // Define ECS deploy action
  const deployAction = new codepipeline_actions.EcsDeployAction({
    actionName: `DeployAction-${appEnv}`,
    service: fargateService,
    imageFile: new codepipeline.ArtifactPath(
      buildOutput,
      `imagedefinitions.json`
    ),
  });

  // Create the pipeline and add stages
  const pipeline = new codepipeline.Pipeline(
    stack,
    `${appName}-Pipeline-${appEnv}`,
    {
      stages: [
        {
          stageName: "Source",
          actions: [sourceAction],
        },
        {
          stageName: "Build",
          actions: [buildAction],
        },
        {
          stageName: `Deploy-to-ECS-${appEnv}`,
          actions: [deployAction],
        },
      ],
    }
  );

  return pipeline;
}
