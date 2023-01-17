#!/usr/bin/env python3

import boto3
from crhelper import CfnResource
from botocore.exceptions import ClientError

helper = CfnResource()

try:
  pass
except Exception as e:
  helper.init_failure(e)
  
def clean_up_access_key(username, access_key_id):
  iam = boto3.client('iam')
  try:
    iam.delete_access_key(UserName=username, AccessKeyId=access_key_id)
  except ClientError as e:
    if e.response['Error']['Code'] == 'NoSuchEntity':
      print("Access key %s or user %s already deleted" % (access_key_id, username))
  
def write_secret(props, key_response):
  try:
    client = boto3.client('secretsmanager')

    response = client.create_secret(
      Name=props['SecretName'],
      SecretString='{"AWS_ACCESS_KEY_ID": "%s", "AWS_SECRET_ACCESS_KEY": "%s"}' % (key_response['AccessKey']['AccessKeyId'], key_response['AccessKey']['SecretAccessKey']),
      Description='AWS Access Keys for %s' % props['UserName'],
      KmsKeyId=props['KmsKeyId'],
    )

    return {
      'response': response,
      'accessKeyId': key_response['AccessKey']['AccessKeyId']
    }
  except ClientError as e:
    if e.response['Error']['Code'] == 'ResourceExistsException':
      if props['Override'] == 'true':
        print("Secret already exists, updating it")
        return write_updated_secret(props, key_response)
      else:
        print("Secret already exists and cant be written, cleaning up access key")
        clean_up_access_key(props['UserName'], key_response['AccessKey']['AccessKeyId'])
        raise e
    elif e.response['Error']['Code'] == 'InvalidRequestException':
      if 'secret with this name is already scheduled for deletion' in e.response['Error']['Message'] and props['Restore'] == 'true':
        print('Secret already exists and is scheduled for deletion, restoring it')
        client = boto3.client('secretsmanager')
        client.restore_secret(SecretId=props['SecretName'])
        return write_updated_secret(props, key_response)
      else:
        print("Unknown error creating secret, cleaning up access key")
        clean_up_access_key(props['UserName'], key_response['AccessKey']['AccessKeyId'])
        raise e
    else:
      print("Unknown error creating secret, cleaning up access key")
      clean_up_access_key(props['UserName'], key_response['AccessKey']['AccessKeyId'])
      raise e
  
def write_updated_secret(props, key_response):
  try:
    client = boto3.client('secretsmanager')

    response = client.update_secret(
      SecretId=props['SecretName'],
      SecretString='{"AWS_ACCESS_KEY_ID": "%s", "AWS_SECRET_ACCESS_KEY": "%s"}' % (key_response['AccessKey']['AccessKeyId'], key_response['AccessKey']['SecretAccessKey']),
      Description='AWS Access Keys for %s' % props['UserName'],
      KmsKeyId=props['KmsKeyId'],
    )

    return {
      'response': response,
      'accessKeyId': key_response['AccessKey']['AccessKeyId']
    }
  except ClientError as e:
    if e.response['Error']['Code'] == 'ResourceNotFoundException':
      print("Secret not found, creating it")
      return write_secret(props, key_response)
    elif e.response['Error']['Code'] == 'InvalidRequestException':
      if 'secret with this name is already scheduled for deletion' in e.response['Error']['Message'] and props['Restore'] == 'true':
        print('Secret is scheduled for deletion, restoring it')
        client = boto3.client('secretsmanager')
        client.restore_secret(SecretId=props['SecretName'])
        write_updated_secret(props, key_response)
      else:
        print("Unknown error updating secret, cleaning up access key: %s" % e.response['Error']['Code'])
        clean_up_access_key(props['UserName'], key_response['AccessKey']['AccessKeyId'])
        raise e
    else:
      print("Unknown error updating secret, cleaning up access key: %s" % e.response['Error']['Code'])
      clean_up_access_key(props['UserName'], key_response['AccessKey']['AccessKeyId'])
      raise e

def create_secret(props):
  iam = boto3.client('iam')
  
  key_response = iam.create_access_key(UserName=props['UserName'])
  
  return write_secret(props, key_response)

def update_secret(props):
  iam = boto3.client('iam')
  
  key_response = iam.create_access_key(UserName=props['UserName'])

  return write_updated_secret(props, key_response)

@helper.create
@helper.update
@helper.delete
def on_event(event, context):
  print(event)
  request_type = event['RequestType']
  if request_type == 'Create': return on_create(event)
  if request_type == 'Update': return on_update(event)
  if request_type == 'Delete': return on_delete(event)
  raise Exception("Invalid request type: %s" % request_type)

def on_create(event):
  props = event["ResourceProperties"]
  print("create new resource with props %s" % props)
  
  secret = create_secret(props)
  
  helper.Data.update({
    'AccessKeyId': secret['accessKeyId'],
    'SecretArn': secret['response']['ARN']
  })
  
  if not helper.Data.get('SecretArn') and helper.Data.get('AccessKeyId'):
    raise Exception('SecretArn or AccessKeyId not set %s' % helper.Data)

  return '%s/%s' % (props['UserName'], secret['accessKeyId'])

def on_update(event):
  physical_id = event["PhysicalResourceId"]
  props = event["ResourceProperties"]
  old_props = event["OldResourceProperties"]
  print("update resource %s with props %s" % (physical_id, props))
  
  if old_props['Region'] != props['Region'] or old_props['SecretName'] != props['SecretName']:
    print("Secret name or region changed, deleting old secret")
    on_delete(event)
    return on_create(event)
  else:
    secret = update_secret(props)
    clean_up_access_key(old_props['UserName'], physical_id.split('/')[1])

    helper.Data.update({
      'AccessKeyId': secret['accessKeyId'],
      'SecretArn': secret['response']['ARN']
    })
    
    if not helper.Data.get('SecretArn') and helper.Data.get('AccessKeyId'):
      raise Exception('SecretArn or AccessKeyId not set %s' % helper.Data)

    return '%s/%s' % (props['UserName'], secret['accessKeyId'])
  

def on_delete(event):
  physical_id = event["PhysicalResourceId"]
  props = event["ResourceProperties"]
  print("delete resource %s" % physical_id)
  
  clean_up_access_key(props['UserName'], physical_id.split('/')[1])
  
  try:
    secrets_manager = boto3.client('secretsmanager')
    secrets_manager.delete_secret(SecretId=props['SecretName'])
  except ClientError as e:
    if e.response['Error']['Code'] == 'ResourceNotFoundException':
      print("Secret %s already deleted" % props['SecretName'])
  
  return physical_id

def handler(event, context):
  helper(event, context)
