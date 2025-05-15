"""
Authorize the request
"""
from functools import wraps
import json
import logging
from typing import Callable
from urllib.request import urlopen

from fastapi import Request, HTTPException
import jwt

logger = logging.getLogger()
logger.setLevel(logging.INFO)

class AuthorizationError(Exception):
    """Custom exception for authorization errors"""

def get_auth_info(request: Request) -> str:
    """
    Get authorization token and oidc info from either headers or query parameters
    """
    authorization = request.headers.get("Authorization") or request.query_params.get("Authorization")
    oidc_info = request.headers.get("Oidc-Info") or request.query_params.get("Oidc-Info")

    return authorization.replace("Bearer", "").strip(), json.loads(oidc_info)

def require_auth(func: Callable):
    """
    Decorator to require authentication for endpoints
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        request = None
        # First check kwargs
        if 'request' in kwargs:
            request = kwargs['request']
        # Then check args
        if not request:
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break

        if not request:
            logger.error("Request object not found in args or kwargs")
            raise HTTPException(status_code=500, detail="Request object not found")

        logger.info(f"Request headers: {request.headers}")

        authorization, oidc_info = get_auth_info(request)
        
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization token missing")
        if not oidc_info:
            raise HTTPException(status_code=401, detail="Oidc-Info missing")
        try:
            headers = jwt.get_unverified_header(authorization)
            kid = headers["kid"]
            if oidc_info.get("provider") == "authing":
                keys_url = f"{oidc_info.get('redirectUri')}/oidc/.well-known/jwks.json"
            else:
                pool_id = oidc_info.get("poolId")
                keys_url = f"https://cognito-idp.{pool_id.split('_')[0]}.amazonaws.com/{pool_id}/.well-known/jwks.json"

            response = urlopen(keys_url)
            keys = json.loads(response.read())["keys"]
            key_index = -1
            for i, key in enumerate(keys):
                if kid == key["kid"]:
                    key_index = i
                    break
            if key_index == -1:
                logger.error("Custom Authorizer Error: Public key not found in jwks.json")
                raise AuthorizationError(
                    "Custom Authorizer Error: Public key not found in jwks.json"
                )
        except AuthorizationError as e:
            raise HTTPException(status_code=401, detail=str(e)) from e

        return await func(*args, **kwargs)
    return wrapper
