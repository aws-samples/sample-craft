"""
Lambda function for managing chat history operations.
Provides REST API endpoints for listing sessions, messages,
and managing message ratings.
"""

import json
import logging
import os
import subprocess
import tempfile
from typing import Any, Dict
from decimal import Decimal
import boto3

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)
region_name = os.environ.get("AWS_REGION")

s3 = boto3.client('s3', region_name=region_name)

class DecimalEncoder(json.JSONEncoder):
    """Custom JSON encoder for Decimal types"""

    def default(self, o):
        if isinstance(o, Decimal):
            return str(o)
        return super(DecimalEncoder, self).default(o)

class Config:
    """Configuration constants"""

    CORS_HEADERS = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
    }

class DocConverterResponse:
    """Standardized API response handler"""

    @staticmethod
    def success(data: Any, status_code: int = 200) -> Dict:
        return {"statusCode": status_code, "headers": Config.CORS_HEADERS, "body": json.dumps(data, cls=DecimalEncoder)}

    @staticmethod
    def error(message: str, status_code: int = 500) -> Dict:
        logger.error("Error: %s", message)
        return {"statusCode": status_code, "headers": Config.CORS_HEADERS, "body": json.dumps({"error": str(message)})}

class DocConverter:
    """API endpoint handlers"""
    @staticmethod
    def word(event: Dict) -> Dict:
        """Handle POST /chat-history/sessions/{sessionId}/messages endpoint"""
        input_body = json.loads(event["body"])
        bucket = input_body.get("bucket")
        file_key = input_body.get("key")
        file_name = os.path.basename(file_key)
        
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_doc = os.path.join(tmpdir, file_name)
            tmp_pdf = tmp_doc.replace('.docx', '.pdf').replace('.doc', '.pdf')
            pdf_key = file_key.replace('.docx', '.converted.pdf').replace('.doc', '.converted.pdf')
            # Check if PDF already exists
            try:
                s3.head_object(Bucket=bucket, Key=pdf_key)
            except s3.exceptions.ClientError as e:
                if e.response['Error']['Code'] == '404':
                    # File doesn't exist, continue with conversion
                    # Download the document from S3
                    s3.download_file(bucket, file_key, tmp_doc)
                    try:
                        subprocess.run([
                            '/opt/libreoffice/program/soffice',
                            '--headless',
                            '--convert-to', 'pdf',
                            '--outdir', tmpdir,
                            tmp_doc
                        ], check=True, capture_output=True, text=True)
                    except subprocess.CalledProcessError as cpe:
                        logger.error("LibreOffice conversion failed: %s", cpe.stderr)
                        raise Exception("PDF conversion failed: %s", cpe.stderr)

                    with open(tmp_pdf, 'rb') as pdf_file:
                        s3.upload_fileobj(pdf_file, bucket, pdf_key, ExtraArgs={'ContentType': 'application/pdf'})
                else:
                    return DocConverterResponse.error(str(e))

            url = s3.generate_presigned_url('get_object', Params={
                'Bucket': bucket,
                'Key': pdf_key
            }, ExpiresIn=60*15)

            return DocConverterResponse.success(url)
    
    @staticmethod
    def pdf(event: Dict) -> Dict:
        """Handle POST /chat-history/sessions/{sessionId}/messages endpoint"""
        input_body = json.loads(event["body"])
        bucket = input_body.get("bucket")
        file_key = input_body.get("key")
        try:
            url = s3.generate_presigned_url('get_object', Params={
                'Bucket': bucket,
                'Key': file_key
            }, ExpiresIn=60*15)
            return DocConverterResponse.success(url)
        except Exception as e:
            return DocConverterResponse.error(str(e))

def lambda_handler(event: Dict, context: Any) -> Dict:
    """Routes API requests to appropriate handlers based on HTTP method and path"""
    logger.info("Received event: %s", json.dumps(event))

    routes = {
        # More RESTful paths
        ("POST", "/viewer/word"): DocConverter.word,
        ("POST", "/viewer/pdf"): DocConverter.pdf
    }

    handler = routes.get((event["httpMethod"], event["resource"]))
    if not handler:
        return DocConverterResponse.error("Route not found", 404)

    return handler(event)
