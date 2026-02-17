> [!WARNING]
> This project is no longer maintained. You should use the [first party AccessKey L2 construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.AccessKey.html)

# AWS CDK Construct for IAM User Access Keys

[![build](https://github.com/RenovoSolutions/cdk-library-aws-iam-access-key/actions/workflows/build.yml/badge.svg)](https://github.com/RenovoSolutions/cdk-library-aws-iam-access-key/actions/workflows/build.yml)

This construct creates IAM user access keys securely.

> **Warning**
> This is a WIP project

## Overview

- Uses a custom resource to generate AWS credentials
- Uploads the resulting credentials to AWS Secrets Manager

## Usage examples

See [API](API.md) doc for full details

**typescript example:**

```typescript
const user = new iam.User(this, 'exampleUser')

new AccessKey(this, 'iamUserAccessKeyExample', {
  user,
});
```
