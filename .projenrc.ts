import { awscdk, javascript } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'Renovo Solutions',
  authorAddress: 'webmaster+cdk@renovo1.com',
  projenrcTs: true,
  cdkVersion: '2.202.0',
  jsiiVersion: '^5.8.0',
  defaultReleaseBranch: 'master',
  name: '@renovosolutions/cdk-library-aws-iam-access-key',
  description: 'AWS CDK Construct Library for generating AWS access keys and storing them in Secrets Manager',
  repositoryUrl: 'https://github.com/brandon/cdk-library-aws-iam-access-key.git',
  keywords: [
    'cdk',
    'aws-cdk',
    'aws-cdk-construct',
    'projen',
    'aws-iam',
  ],
  buildWorkflow: false,
  depsUpgrade: true,
  depsUpgradeOptions: {
    workflow: false,
    workflowOptions: {
      labels: ['auto-approve', 'deps-upgrade'],
    },
    exclude: ['projen'],
  },
  githubOptions: {
    mergify: false,
    mergifyOptions: {
      rules: [
        {
          name: 'Automatically approve dependency upgrade PRs if they pass build',
          actions: {
            review: {
              type: 'APPROVE',
              message: 'Automatically approved dependency upgrade PR',
            },
          },
          conditions: [
            'label=auto-approve',
            'label=deps-upgrade',
            '-label~=(do-not-merge)',
            'status-success=build',
            'author=github-actions[bot]',
            'title="chore(deps): upgrade dependencies"',
          ],
        },
      ],
    },
    pullRequestLintOptions: {
      semanticTitle: false,
      semanticTitleOptions: {
        types: [
          'chore',
          'docs',
          'feat',
          'fix',
          'ci',
          'refactor',
          'test',
        ],
      },
    },
  },
  releaseToNpm: true,
  npmAccess: javascript.NpmAccess.PUBLIC,
  release: true,
  docgen: true,
  eslint: true,
  publishToPypi: {
    distName: 'renovosolutions.aws-iam-access-key',
    module: 'renovosolutions_iam_access_key',
  },
  publishToNuget: {
    dotNetNamespace: 'renovosolutions',
    packageId: 'Renovo.AWSCDK.AWSIAMAccessKey',
  },
});

new javascript.UpgradeDependencies(project, {
  include: ['projen'],
  taskName: 'upgrade-projen',
  workflow: false,
  workflowOptions: {
    schedule: javascript.UpgradeDependenciesSchedule.expressions(['0 2 * * 1']),
  },
  pullRequestTitle: 'upgrade projen',
});

// Ignore the release workflow file so it's not committed to git
project.gitignore.exclude('!/.github/workflows/release.yml');
project.gitignore.addPatterns('.github/workflows/release.yml');

project.synth();
