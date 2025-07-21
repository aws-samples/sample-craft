# Knowledge Base ETL Service Migration

This directory contains the migrated ETL service from AWS Glue to ECS with FastAPI.

## Architecture Changes

- **Before**: Step Function → Glue Job
- **After**: ECS Fargate Service with FastAPI + Application Load Balancer

## Files

- `fastapi_app.py` - FastAPI application that wraps the existing Glue job functionality
- `Dockerfile` - Container definition for the FastAPI service
- `requirements.txt` - Python dependencies
- `build-and-push.sh` - Script to build and push Docker image to ECR
- `glue-job-script.py` - Original Glue job script (unchanged)

## Deployment Steps

1. **Build and Push Docker Image**:
   ```bash
   cd /path/to/lambda/job
   ./build-and-push.sh <aws-account-id> <region>
   ```

2. **Deploy CDK Stack**:
   ```bash
   cdk deploy
   ```

## API Endpoints

The FastAPI service exposes the following endpoints:

- `GET /health` - Health check
- `POST /etl/jobs` - Create and start an ETL job
- `GET /etl/jobs/{job_id}` - Get job status
- `GET /etl/jobs` - List all jobs

## Usage Example

```bash
# Create an ETL job
curl -X POST "http://load-balancer-url/etl/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "s3_bucket": "my-bucket",
    "s3_prefix": "documents/",
    "operation_type": "create",
    "document_language": "en"
  }'

# Check job status
curl "http://load-balancer-url/etl/jobs/{job_id}"
```

## Environment Variables

The ECS service uses the following environment variables (set automatically by CDK):

- `AOS_ENDPOINT` - OpenSearch endpoint
- `AWS_REGION` - AWS region
- `ETL_MODEL_ENDPOINT` - Model endpoint for embeddings
- `RES_BUCKET` - Results bucket
- `ETL_OBJECT_TABLE` - DynamoDB table for ETL objects
- `PORTAL_BUCKET` - Portal bucket
- `CHATBOT_TABLE` - Chatbot table
- `AOS_SECRET_ARN` - OpenSearch secret ARN
- `BEDROCK_REGION` - Bedrock region
- `MODEL_TABLE` - Model table

## Benefits of Migration

1. **Better API Interface**: RESTful API instead of Step Function execution
2. **Real-time Status**: Check job status via HTTP endpoints
3. **Scalability**: ECS auto-scaling capabilities
4. **Cost Optimization**: Pay only for running containers
5. **Easier Integration**: Standard HTTP API for frontend integration