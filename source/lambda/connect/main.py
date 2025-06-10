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
        auth_token = get_auth_token()
        
        # Extract message from SQS event
        for record in event['Records']:
            message = json.loads(record['body'])
            
            # Prepare request payload for /llm endpoint
            payload = {
                "query": message.get('query', ''),
                "entry_type": message.get('entry_type', 'common'),
                "session_id": message.get('session_id'),
                "user_id": message.get('user_id'),
                "chatbot_config": message.get('chatbot_config', {})
            }
            
            # Call the /llm endpoint
            response = requests.post(
                f'http://{alb_endpoint}/llm',
                json=payload,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': auth_token
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
