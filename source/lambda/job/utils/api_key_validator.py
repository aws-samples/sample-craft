import json
import logging
import os
import boto3
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)

class APIKeyValidator:
    """Validates API keys against stored secrets in AWS Secrets Manager"""
    
    def __init__(self):
        self.secrets_client = boto3.client('secretsmanager')
        self.api_key_secret_arn = os.getenv('API_KEY_SECRET_ARN')
        
    @lru_cache(maxsize=1)
    def _get_valid_api_key(self) -> Optional[str]:
        """Retrieve the valid API key from Secrets Manager (cached)"""
        if not self.api_key_secret_arn:
            logger.warning("API_KEY_SECRET_ARN environment variable not set")
            return None
            
        try:
            response = self.secrets_client.get_secret_value(SecretId=self.api_key_secret_arn)
            secret_data = json.loads(response['SecretString'])
            return secret_data.get('api_key')
        except Exception as e:
            logger.error(f"Failed to retrieve API key from Secrets Manager: {e}")
            return None
    
    def validate_api_key(self, provided_key: str) -> bool:
        """Validate the provided API key against the stored key"""
        if not provided_key:
            return False
            
        valid_key = self._get_valid_api_key()
        if not valid_key:
            logger.error("No valid API key found in Secrets Manager")
            return False
            
        return provided_key == valid_key