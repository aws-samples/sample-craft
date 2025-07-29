import os
import boto3
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)
TARGET_LAMBDA_ARN = os.environ.get('TARGET_LAMBDA_ARN', '')
COGNITO_USER_POOL_ID = os.environ.get('COGNITO_USER_POOL_ID', '')
COGNITO_CLIENT_ID = os.environ.get('COGNITO_CLIENT_ID', '')
AGENTCORE_ROLE_ARN = os.environ.get('AGENTCORE_ROLE_ARN', '')
REGION = os.environ.get('AWS_REGION', 'us-east-1')


def get_cognito_discovery_url():
    # Use pre-created Cognito resources from CDK
    cognito_discovery_url = f'https://cognito-idp.{REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/openid-configuration'
    return COGNITO_CLIENT_ID, cognito_discovery_url


def handler(event, context):
    request_type = event['RequestType']
    
    try:
        if request_type == 'Create':
            client_id, cognito_discovery_url = get_cognito_discovery_url()
            gateway_client = boto3.client('bedrock-agentcore-control', region_name=REGION)
            
            auth_config = {
                "customJWTAuthorizer": { 
                    "allowedClients": [client_id],
                    "discoveryUrl": cognito_discovery_url
                }
            }
            
            create_response = gateway_client.create_gateway(
                name='etl-mcp-gateway',
                roleArn=AGENTCORE_ROLE_ARN,
                protocolType='MCP',
                authorizerType='CUSTOM_JWT',
                authorizerConfiguration=auth_config, 
                description='AgentCore Gateway for ETL MCP tools'
            )
            
            gatewayID = create_response["gatewayId"]
            gatewayURL = create_response["gatewayUrl"]

            lambda_target_config = {
                "mcp": {
                    "lambda": {
                        "lambdaArn": TARGET_LAMBDA_ARN,
                        "toolSchema": {
                            "inlinePayload": [
                                {
                                    "name": "file_extraction_tool",
                                    "description": "Tool to extract the file such as PDF, DOCX, HTML, CSV, PNG, JPG, XLSX and convert it into markdown format, it can also split the file into chunks",
                                    "inputSchema": {
                                        "type": "object",
                                        "properties": {
                                            "s3_bucket": {
                                                "type": "string"
                                            },
                                            "s3_prefix": {
                                                "type": "string"
                                            },
                                        },
                                        "required": ["s3_bucket", "s3_prefix"]
                                    }
                                }
                            ]
                        }
                    }
                }
            }

            credential_config = [ 
                {
                    "credentialProviderType" : "GATEWAY_IAM_ROLE"
                }
            ]
            
            gateway_client.create_gateway_target(
                gatewayIdentifier=gatewayID,
                name='LambdaTarget',
                description='Lambda Target for ETL processing',
                targetConfiguration=lambda_target_config,
                credentialProviderConfigurations=credential_config
            )
            
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
