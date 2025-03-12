import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as fs from "fs";

/**
 * Creates SSM parameters from an environment file
 */
export function createSSMParamsFromEnvFile(
  stack: cdk.Stack,
  envFilePath: string,
  appName: string,
  environment: string
): void {
  // Parse the env file
  const envContent = fs.readFileSync(envFilePath, "utf-8");
  const envVars: Record<string, string> = {};

  // Parse each line of the env file
  envContent.split("\n").forEach((line) => {
    const line_clean = line.trim();
    if (line_clean && !line_clean.startsWith("#")) {
      const [key, ...valueParts] = line_clean.split("=");
      if (key) {
        // Handle values that might contain = characters
        const value = valueParts.join("=");
        // Remove quotes if present
        const cleanValue = value.replace(/^["'](.*)["']$/, "$1");
        envVars[key.trim()] = cleanValue.trim();
      }
    }
  });

  // Create SSM parameters for each env var
  Object.entries(envVars).forEach(([key, value]) => {
    new ssm.StringParameter(stack, `SSMParam-${environment}-${key}`, {
      parameterName: `/${appName}/${environment}/${key}`,
      stringValue: value,
      type: ssm.ParameterType.SECURE_STRING,
      description: `${key} for ${appName} ${environment}`,
    });
  });
}
