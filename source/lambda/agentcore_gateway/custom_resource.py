import os
import boto3
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)
TARGET_ALB_URL = os.environ.get('TARGET_ALB_URL', '')
COGNITO_USER_POOL_ID = os.environ.get('COGNITO_USER_POOL_ID', '')
COGNITO_CLIENT_ID = os.environ.get('COGNITO_CLIENT_ID', '')
AGENTCORE_ROLE_ARN = os.environ.get('AGENTCORE_ROLE_ARN', '')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
OPENAPI_FILE_ARN = os.environ.get('OPENAPI_FILE_ARN', '')
API_KEY_SECRET_ARN = os.environ.get('API_KEY_SECRET_ARN', '')


def get_api_key():
    """Retrieve API key from Secrets Manager"""
    if not API_KEY_SECRET_ARN:
        logger.warning("API_KEY_SECRET_ARN not set")
        return None
    
    try:
        secrets_client = boto3.client('secretsmanager', region_name=REGION)
        response = secrets_client.get_secret_value(SecretId=API_KEY_SECRET_ARN)
        secret_data = json.loads(response['SecretString'])
        return secret_data.get('api_key')
    except Exception as e:
        logger.error(f"Failed to retrieve API key: {e}")
        return None

def get_cognito_discovery_url():
    # Use pre-created Cognito resources from CDK
    cognito_discovery_url = f'https://cognito-idp.{REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/openid-configuration'
    return COGNITO_CLIENT_ID, cognito_discovery_url


def handler(event, context):
    request_type = event['RequestType']
    
    try:
        if request_type == 'Create':
            # Get API key for authentication
            api_key = get_api_key()
            if not api_key:
                raise Exception("Failed to retrieve API key from Secrets Manager")
            
            logger.info(f"Retrieved API key for gateway configuration")
            
            client_id, cognito_discovery_url = get_cognito_discovery_url()
            gateway_client = boto3.client('bedrock-agentcore-control', region_name=REGION)

            response=gateway_client.create_api_key_credential_provider(
                name="CraftAPIKey",
                apiKey=api_key,
            )
            credentialProviderARN = response['credentialProviderArn']
            
            auth_config = {
                "customJWTAuthorizer": { 
                    "allowedClients": [client_id],
                    "discoveryUrl": cognito_discovery_url
                }
            }
            
            create_response = gateway_client.create_gateway(
                name='craft-gateway',
                roleArn=AGENTCORE_ROLE_ARN,
                protocolType='MCP',
                authorizerType='CUSTOM_JWT',
                authorizerConfiguration=auth_config, 
                description='AgentCore Gateway for CRAFT tools'
            )
            
            gatewayID = create_response["gatewayId"]
            gatewayURL = create_response["gatewayUrl"]

            openapi_s3_target_config = {
                "mcp": {
                    "openApiSchema": {
                        "s3": {
                            "uri": OPENAPI_FILE_ARN
                        }
                    }
                }
            }
            api_key_credential_config = [
                {
                    "credentialProviderType" : "API_KEY", 
                    "credentialProvider": {
                        "apiKeyCredentialProvider": {
                                "credentialParameterName": "Authorization",
                                "providerArn": credentialProviderARN,
                                "credentialLocation":"HEADER", # Location of api key. Possible values are "HEADER" and "QUERY_PARAMETER".
                                #"credentialPrefix": " " # Prefix for the token. Valid values are "Basic". Applies only for tokens.
                        }
                    }
                }
            ]

            response = gateway_client.create_gateway_target(
                gatewayIdentifier=gatewayID,
                name='CraftOpenAPITarget',
                description='OpenAPI Target for CRAFT tools',
                targetConfiguration=openapi_s3_target_config,
                credentialProviderConfigurations=api_key_credential_config)
            logger.info(f"Created Gateway Target: {response}")
            
            return {
                'Status': 'SUCCESS',
                'Data': {
                    'GatewayId': gatewayID,
                    'GatewayUrl': gatewayURL
                }
            }
        
        elif request_type == 'Delete':
            return {
                'Status': 'SUCCESS'
            }
            
        else:
            return {
                'Status': 'SUCCESS'
            }
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {
            'Status': 'FAILED',
            'Reason': str(e)
        }
