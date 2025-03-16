import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { AppEnvironment } from "./ComputeStack";

/**
 * Interface for configuring SSM parameters.
 */
export interface SSMParameterConfig {
  /** The name of the SSM parameter. */
  name: string;
  /** The corresponding environment variable key. */
  envKey: string;
  /** Optional description for the SSM parameter. */
  description?: string;
  /** Optional environment-specific values. */
  environments?: {
    [key: string]: string;
  };
}

/**
 * Interface wrapping an SSM parameter with its ARN.
 */
export interface SSMParameterWrapper {
  /** The SSM parameter. */
  parameter: ssm.StringParameter;
  /** The ARN of the SSM parameter. */
  parameterArn: string;
}

/**
 * Creates SSM parameters based on the provided configuration and environment.
 *
 * @param stack - The CDK stack in which to create the SSM parameters.
 * @param params - An array of SSM parameter configurations.
 * @param appEnv - The current application environment.
 * @returns An object containing the created SSM parameters, keyed by their environment variable names.
 */
export default function createSSMParameters(
  stack: cdk.Stack,
  params: SSMParameterConfig[],
  appEnv: AppEnvironment
): { [key: string]: SSMParameterWrapper } {
  // Load the appropriate .env file based on the appEnv
  const envFile = path.resolve(process.cwd(), `.env.${appEnv}`);

  //console.log(`Attempting to load environment file: ${envFile}`);

  let envValues: { [key: string]: string } = {};

  if (fs.existsSync(envFile)) {
    //console.log(`Environment file exists: ${envFile}`);
    const envConfig = dotenv.config({ path: envFile });

    if (envConfig.error) {
      //console.error(`Error loading .env file: ${envConfig.error}`);
    } else {
      //console.log('Environment file loaded successfully');
      envValues = envConfig.parsed || {};
    }
  } else {
    //console.error(`Environment file does not exist: ${envFile}`);
  }

  //console.log('Loaded environment values:');
  //console.log(envValues);

  const createdParams: { [key: string]: SSMParameterWrapper } = {};

  params.forEach((param) => {
    let value: string | undefined;
    let paramName = param.name;

    //console.log(`Processing parameter: ${param.name}`);

    // Check if the parameter name is environment-specific
    if (param.name.includes(`-${appEnv}`)) {
      // Use the environment-specific parameter name
      paramName = param.name;
      value = envValues[param.envKey];
      //console.log(`Using environment-specific parameter name: ${paramName}`);
    } else if (param.environments && param.environments[appEnv]) {
      // Use environment-specific value if available
      value = param.environments[appEnv];
      paramName = `${param.name}-${appEnv}`;
    } else {
      // Fall back to the general environment variable
      value = envValues[param.envKey];
    }

    //console.log(`Final value for ${paramName}: ${value}`);

    if (value) {
      // Create the SSM parameter
      const stringParam = new ssm.StringParameter(
        stack,
        `SSMParam-${paramName}`,
        {
          parameterName: paramName,
          stringValue: value,
          description: param.description,
        }
      );

      // Store the created parameter with its ARN
      createdParams[param.envKey] = {
        parameter: stringParam,
        parameterArn: stack.formatArn({
          service: "ssm",
          resource: "parameter",
          resourceName: paramName.startsWith("/")
            ? paramName.slice(1)
            : paramName,
        }),
      };
      //console.log(`Created SSM parameter: ${paramName} with value: ${value}`);
    } else {
      //console.warn(
      //   `Warning: Value for ${param.envKey} is not set for SSM parameter ${paramName} in ${appEnv} environment`,
      // );
    }
  });

  return createdParams;
}
