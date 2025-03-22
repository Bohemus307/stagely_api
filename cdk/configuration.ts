import * as iam from "aws-cdk-lib/aws-iam";

export const ACCOUNT_ID = "337654367097";
export const HOSTED_ZONE_ID = "Z030182822ZM7ITV2KDZU";
export const HOSTED_ZONE_NAME = 'stoneandsage.dev';
export const GH_USERNAME = 'bohemus307';
export const GH_REPO_NAME = 'stagely_api'; 
export const CODESTAR_CONNECTION_ARN =
  "arn:aws:codeconnections:us-east-1:337654367097:connection/4d12089b-2ab3-437d-98c6-7b5c0aec3be5";

export const APP_NAME = 'stagely';
export const GH_BRANCH = 'main';
export const STAGING_SUBDOMAIN = 'staging-api-stagely';
export const PROD_SUBDOMAIN = 'api-stagely';
// This region controls where your CDK resources are created and also separately controls where the ACM cert gets created.
export const RESOURCE_DEPLOYMENT_REGION = 'us-east-1'; // or chosen region from step 5

export const DB_VPC_ID = "vpc-098964c5533f8a8b1";

// permissions your fargate task will have
// permissions your fargate task will have
export const taskExecutionIamPoliciesJSON = [
  {
    effect: iam.Effect.ALLOW,
    resources: ['*'],
    actions: [
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      'ecr:GetAuthorizationToken',
      'ecr:BatchCheckLayerAvailability',
      'ecr:GetDownloadUrlForLayer',
      'ecr:GetRepositoryPolicy',
      'ecr:DescribeRepositories',
      'ecr:ListImages',
      'ecr:DescribeImages',
      'ecr:BatchGetImage',
      'ecr:GetLifecyclePolicy',
      'ecr:GetLifecyclePolicyPreview',
      'ecr:ListTagsForResource',
      'ecr:DescribeImageScanFindings',
      'ecr:InitiateLayerUpload',
      'ecr:UploadLayerPart',
      'ecr:CompleteLayerUpload',
      'ecr:PutImage',
      'secretsmanager:GetSecretValue',
      'secretsmanager:DescribeSecret',
      'rds:Connect',
      'rds:ExecuteStatement',
      'rds:CreateDBInstance',
    ],
  },
];