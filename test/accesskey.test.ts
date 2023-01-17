import {
  Stack,
  App,
  aws_iam as iam,
} from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  AccessKey,
} from '../src/index';

test('Snapshot', () => {
  const app = new App();
  const stack = new Stack(app, 'TestStack');

  const user = new iam.User(stack, 'User', {});

  new AccessKey(stack, 'AccessKey', {
    user,
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
});