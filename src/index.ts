import * as path from 'path';
import {
  aws_iam as iam,
  CustomResource,
  aws_lambda as lambda,
  aws_secretsmanager as secretsmanager,
  Duration,
  Names,
  Stack,
  Tags,
  aws_kms as kms,
  RemovalPolicy,
  aws_s3 as s3,
  aws_s3_deployment as s3Deploy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * The properties of a new set of SMTP Credentials
 */
export interface AccessKeyProps {
  /**
   * The IAM user the access key will be created for.
   */
  readonly user: iam.User;
  /**
   * If a secret is pending deletion should it be restored?
   *
   * This helps in cases where cloudformation roll backs puts a secret in pending delete state.
   *
   * @default true
   */
  readonly restoreSecret?: boolean;
  /**
   * If a secret already exists should it be overwritten?
   *
   * This helps in cases where cloudformation creates a secret successfully but it gets orphaned for some reason.
   *
   * @default true
   */
  readonly overwriteSecret?: boolean;
  /**
   * The KMS key to use for the secret
   *
   * @default - default key
   */
  readonly kmsKey?: kms.IKey;
  /**
   * The lambda function code to use for the custom resource.
   *
   * For most use cases this should be left as the default, but
   * in cases where the custom resource needs to be deployed through
   * something like CloudFormation StackSets you may need to source
   * the lambda function code from S3 or some other location because
   * the CDK cant upload the local code to the correct asset location
   * for the StackSet target accounts.
   *
   * You can use the included `AccessKeyFunctionCodeCache` class to
   * cache the lambda function code in S3 and create a cross
   * account access policy to allow the StackSet target accounts
   * to access the code.
   *
   * @default - default lambda function code
   */
  readonly lambdaCode?: lambda.Code;
}

export class AccessKey extends Construct {
  /**
   * The AWS secrets manager secret that contains the access key.
   */
  public readonly secret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: AccessKeyProps) {
    super (scope, id);

    const secretName = `${Names.uniqueId(this)}${props.user.userName}`;

    Tags.of(props.user).add('CfnStackIdForAccessKeyLibrary', Stack.of(this).stackId);

    const lambdaPolicy = new iam.ManagedPolicy(this, 'SecretsManagerPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          sid: 'SecretsManagerPolicy',
          actions: [
            'secretsmanager:PutSecretValue',
            'secretsmanager:CreateSecret',
            'secretsmanager:DeleteSecret',
            'secretsmanager:UpdateSecret',
            'secretsmanager:TagResource',
            'secretsmanager:RestoreSecret',
          ],
          resources: [`arn:aws:secretsmanager:${Stack.of(this).region}:${Stack.of(this).account}:secret:${secretName}-*`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          sid: 'IamAllowKeyManagementPolicy',
          actions: [
            'iam:CreateAccessKey',
            'iam:DeleteAccessKey',
            'iam:ListAccessKeys',
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'iam:ResourceTag/CfnStackIdForAccessKeyLibrary': Stack.of(this).stackId,
            },
          },
        }),
      ],
    });

    if (props.kmsKey) {
      lambdaPolicy.addStatements(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        sid: 'KmsAllowKeyManagementPolicy',
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
        ],
        resources: [props.kmsKey.keyArn],
      }));
    }

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        lambdaPolicy,
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const onEventHandler = new lambda.Function(this, 'OnEventHandler', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: props.lambdaCode ?? lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: Duration.seconds(30),
      role,
    });

    const secret = new CustomResource(this, 'SecretArn', {
      serviceToken: onEventHandler.functionArn,
      properties: {
        UserName: props.user.userName,
        SecretName: secretName,
        Region: Stack.of(this).region,
        Override: props.overwriteSecret ?? true,
        Restore: props.restoreSecret ?? true,
        KmsKeyId: props.kmsKey == undefined ? 'alias/aws/secretsmanager' : props.kmsKey.keyId,
      },
    });

    this.secret = secretsmanager.Secret.fromSecretCompleteArn(this, 'Secret', secret.getAttString('SecretArn'));
  }
}

export interface AccessKeyFunctionCodeCacheProps extends s3.BucketProps {}

export class AccessKeyFunctionCodeCache extends s3.Bucket {
  /**
   * The lambda.Code object that represents the contents of the bucket.
   */
  public readonly lambdaCode: lambda.Code;

  constructor(scope: Construct, id: string, props: AccessKeyFunctionCodeCacheProps) {
    const removalPolicy = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const autoDeleteObjects = removalPolicy === RemovalPolicy.DESTROY;
    super(scope, id, {
      removalPolicy,
      autoDeleteObjects,
      ...props,
    });

    /** Force the final unzipped asset to be a zip by nesting zips */
    const bundlingCmds = [
      'mkdir -p /asset-output',
      'mkdir -p temp',
      'pip install -r /asset-input/requirements.txt -t /asset-input/temp',
      'cp index.py /asset-input/temp/index.py',
      'cd temp',
      'zip -r lambda.zip .',
      'zip -r /asset-output/temp.zip lambda.zip',
      'cd ..',
      'rm -rf ./temp',
    ];

    new s3Deploy.BucketDeployment(this, 'Deployment', {
      sources: [s3Deploy.Source.asset(path.join(__dirname, '../lambda'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c', bundlingCmds.join(' && '),
          ],
        },
      })],
      destinationBucket: this,
      exclude: ['__pycache__/*', '*.pyc'],
      include: ['*.py'],
    });

    this.lambdaCode = lambda.Code.fromBucket(this, 'index.py');
  }

  /**
   * Add access to the whole organization to get
   * the lambda function code from the bucket.
   *
   * @param principalOrgId The organization ID to require for any accounts accessing the bucket.
   */
  public addOrgWideAccessPolicy(principalOrgId: string): iam.AddToResourcePolicyResult {
    return this.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.StarPrincipal],
      actions: [
        's3:GetObject',
      ],
      resources: [this.arnForObjects('*')],
      conditions: {
        StringEquals: {
          'aws:PrincipalOrgID': principalOrgId,
        },
      },
    }));
  };

  /**
   * Add access to the specified accounts to get
   * the lambda function code from the bucket.
   *
   * @param principalAccountId The account ID to add access for.
   * @param principalOrgId (Optional) The organization ID to require for the account accessing the bucket.
   */
  public addAccountAccessPolicy(principalAccountId: string, principalOrgId?: string): iam.AddToResourcePolicyResult {
    return this.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.AccountPrincipal(principalAccountId)],
      actions: ['s3:GetObject'],
      resources: [this.arnForObjects('*')],
      conditions: principalOrgId === undefined ? undefined : {
        StringEquals: {
          'aws:PrincipalOrgID': principalOrgId,
        },
      },
    }));
  };

  /**
   * Add access to the specified organizational units to get
   * the lambda function code from the bucket.
   *
   * @param principalOrgPaths The organizational unit paths to add access for.
   */
  public addOrgOuAccessPolicy(principalOrgPaths: string[]): iam.AddToResourcePolicyResult {
    return this.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.StarPrincipal],
      actions: ['s3:GetObject'],
      resources: [this.arnForObjects('*')],
      conditions: {
        StringLike: {
          'aws:PrincipalOrgPaths': principalOrgPaths,
        },
      },
    }));
  }
};
