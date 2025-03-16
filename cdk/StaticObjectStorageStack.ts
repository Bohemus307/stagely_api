import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { Distribution, OriginAccessIdentity } from "aws-cdk-lib/aws-cloudfront";
import { aws_certificatemanager as acm } from "aws-cdk-lib";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";

/**
 * Properties for the StaticObjectStorageStack.
 */
interface StaticObjectStorageStackProps extends cdk.StackProps {
  /**
   * The hosted zone name.
   */
  hostedZoneName: string;
  /**
   * The domain prefix.
   */
  domainPrefix: string;
  /**
   * The name of the S3 bucket.
   */
  bucketName: string;
}

/**
 * A stack for creating a static object storage setup with S3, CloudFront, and Route53.
 */
export default class StaticObjectStorageStack extends cdk.Stack {
  /**
   * The S3 bucket to store assets.
   */
  public readonly assetsBucket: Bucket;
  /**
   * The Origin Access Identity for CloudFront.
   */
  public readonly oai: OriginAccessIdentity;
  /**
   * The CloudFront distribution.
   */
  public readonly cloudfrontDistro: Distribution;

  /**
   * Creates a new StaticObjectStorageStack.
   *
   * @param scope The scope in which to define this construct.
   * @param id The scoped construct ID.
   * @param props The stack properties.
   */
  constructor(
    scope: Construct,
    id: string,
    props: StaticObjectStorageStackProps
  ) {
    super(scope, id, props);

    // Create an S3 bucket with public access blocked
    this.assetsBucket = new Bucket(
      this,
      `${props.domainPrefix}-storageBucket`,
      {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        bucketName: props.bucketName,
      }
    );

    // Create an Origin Access Identity for CloudFront
    this.oai = new OriginAccessIdentity(this, "WebsiteOAI");
    this.assetsBucket.grantReadWrite(this.oai);

    // Lookup the hosted zone
    const hostedZone = HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.hostedZoneName,
    });

    // Define the public DNS name
    const publicDnsName = `${props.domainPrefix}.${props.hostedZoneName}`;

    // Create an ACM certificate for the CloudFront distribution
    const certificate = new acm.Certificate(this, "AssetsCDNCert", {
      domainName: publicDnsName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Create the CloudFront distribution
    this.cloudfrontDistro = new Distribution(this, "Distro", {
      certificate,
      domainNames: [publicDnsName],
      defaultBehavior: {
        origin: new S3Origin(this.assetsBucket, {
          originAccessIdentity: this.oai,
        }),
      },
    });

    // Create a Route53 ARecord to alias the CloudFront distribution
    new ARecord(this, "Alias", {
      zone: hostedZone,
      target: RecordTarget.fromAlias(
        new CloudFrontTarget(this.cloudfrontDistro)
      ),
      recordName: publicDnsName,
    });
  }
}
