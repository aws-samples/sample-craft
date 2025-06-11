import json
import boto3
import os
import requests

def get_auth_token():
    secret_name = os.environ['AUTH_TOKEN_SECRET_ARN']
    session = boto3.session.Session()
    client = session.client('secretsmanager')
    
    try:
        response = client.get_secret_value(SecretId=secret_name)
        secret = json.loads(response['SecretString'])
        return secret['token']
    except Exception as e:
        print(f'Error getting auth token: {str(e)}')
        raise e

def lambda_handler(event, context):
    print('Received SQS message:', json.dumps(event))
    
    try:
        # Get ALB endpoint and auth token
        alb_endpoint = os.environ['ALB_ENDPOINT']
        pool_id = os.environ['POOL_ID']
        auth_token = get_auth_token()
        print(auth_token)
        
        # Extract message from SQS event
        for record in event['Records']:
            message = json.loads(record['body'])
            print("message")
            print(message)
            
            
            # Call the /llm endpoint
            response = requests.post(
                f'http://{alb_endpoint}/llm',
                json=message,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': auth_token,
                    'Oidc-Info': '{\"provider\":\"cognito\",\"poolId\":\"' + pool_id + '\"}'
                }
            )
            
            response.raise_for_status()
            print(f'Successfully processed message through /llm endpoint. Response: {response.text}')
        
        return {
            'statusCode': 200,
            'body': json.dumps('Successfully processed messages')
        }
    except Exception as e:
        print('Error:', str(e))
        raise e
