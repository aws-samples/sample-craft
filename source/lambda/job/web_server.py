import json
import logging
import uuid
from fastapi import FastAPI, Request, HTTPException, Depends, status
from pydantic import BaseModel
from typing import Optional, Dict, Any
from main import main
from utils.api_key_validator import APIKeyValidator

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ETL Processing Service")
api_validator = APIKeyValidator()

class ETLRequest(BaseModel):
    s3_bucket: Optional[str] = None
    s3_prefix: Optional[str] = None
    operation_type: Optional[str] = None
    batch_file_number: Optional[str] = None
    batch_indice: Optional[str] = None
    document_language: Optional[str] = None
    index_type: Optional[str] = None
    aos_endpoint: Optional[str] = None
    etl_endpoint_name: Optional[str] = None
    etl_object_table_name: Optional[str] = None
    portal_bucket_name: Optional[str] = None
    bedrock_region: Optional[str] = None
    res_bucket: Optional[str] = None
    aos_index_name: Optional[str] = None

class RequestObj:
    """Request object to mimic Lambda event structure"""
    def __init__(self, data):
        for key, value in data.items():
            setattr(self, key, value)

class Context:
    """Context object to mimic Lambda context"""
    def __init__(self):
        self.aws_request_id = str(uuid.uuid4())

def validate_api_key(request: Request):
    """Validate API key from Authorization header"""
    auth_header = request.headers.get("Authorization")
    logger.info(f"Received Authorization header: {auth_header[:10] + '...' if auth_header else 'None'}")
    
    if not auth_header:
        logger.warning("Missing Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )
    
    is_valid = api_validator.validate_api_key(auth_header)
    logger.info(f"API key validation result: {is_valid}")
    
    if not is_valid:
        logger.warning(f"Invalid API key provided: {auth_header[:10] + '...'}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
    
    logger.info("API key validation successful")
    return auth_header

@app.get("/health")
def health_check():
    """Health check endpoint for ALB"""
    return {"status": "healthy"}

@app.post("/process")
async def process_etl(etl_request: ETLRequest, request: Request, api_key: str = Depends(validate_api_key)):
    """Main ETL processing endpoint"""
    try:
        # Convert request to dict
        data = etl_request.dict(exclude_none=True)
        
        # Add query parameters to data
        query_params = dict(request.query_params)
        data.update(query_params)
        
        logger.info(f"Received request: {json.dumps(data)}")
        
        # Create request and context objects
        req = RequestObj(data)
        context = Context()
        
        # Process the request
        main(req, context.aws_request_id)
        
        return {
            "status": "success",
            "message": "ETL process completed successfully",
            "job_id": context.aws_request_id
        }
        
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            "status": "error",
            "message": str(e)
        }


@app.post("/process-pure")
async def process_etl_pure(etl_request: ETLRequest, request: Request):
    """Main ETL processing endpoint"""
    try:
        # Convert request to dict
        data = etl_request.dict(exclude_none=True)
        
        # Add query parameters to data
        query_params = dict(request.query_params)
        data.update(query_params)
        
        logger.info(f"Received request: {json.dumps(data)}")
        
        # Create request and context objects
        req = RequestObj(data)
        context = Context()
        
        # Process the request
        main(req, context.aws_request_id)
        
        return {
            "status": "success",
            "message": "ETL process completed successfully",
            "job_id": context.aws_request_id
        }
        
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            "status": "error",
            "message": str(e)
        }


@app.get("/")
def root():
    """Root endpoint with service info"""
    return {
        "service": "ETL Processing Service",
        "endpoints": {
            "health": "/health",
            "process": "/process",
            "docs": "/docs"
        }
    }