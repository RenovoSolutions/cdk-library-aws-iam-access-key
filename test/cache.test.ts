import {
  Stack,
  App,
} from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  AccessKeyFunctionCodeCache,
} from '../src/index';

test('Snapshot', () => {
  const app = new App();
  const stack = new Stack(app, 'TestStack');

  const cacheOrgWide = new AccessKeyFunctionCodeCache(stack, 'AccessKeyFunctionCodeCacheOrgWide', {});
  cacheOrgWide.addOrgWideAccessPolicy('o-123456');

  const cacheAccount = new AccessKeyFunctionCodeCache(stack, 'AccessKeyFunctionCodeCacheAccount', {});
  cacheAccount.addAccountAccessPolicy('123456789012');

  const cacheOrgOu = new AccessKeyFunctionCodeCache(stack, 'AccessKeyFunctionCodeCacheOrgOu', {});
  cacheOrgOu.addOrgOuAccessPolicy(['/o-123456/ou']);

  expect(Template.fromStack(stack)).toMatchSnapshot();
});