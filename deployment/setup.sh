#!/bin/bash

# Check if required parameters are provided
if [ $# -lt 3 ]; then
    echo "Usage: $0 <s3-bucket-name> <lambda-function-name> <cloudfront-url>"
    echo "Example: $0 my-api-bucket-name my-agentcore-lambda https://d123456789.cloudfront.net"
    exit 1
fi

BUCKET_NAME="$1"
LAMBDA_FUNCTION_NAME="$2"
CLOUDFRONT_URL="$3"

echo "Using CloudFront URL: $CLOUDFRONT_URL"

# Update OpenAPI spec in S3
echo "Updating OpenAPI spec in bucket: $BUCKET_NAME"

# Download, update, and upload OpenAPI spec
aws s3 cp "s3://$BUCKET_NAME/openapi.json" /tmp/openapi.json

# Update server URL to CloudFront HTTPS URL
jq --arg url "$CLOUDFRONT_URL" '.servers = [{"url": $url, "description": "ETL Processing Service"}]' /tmp/openapi.json > /tmp/openapi_updated.json

aws s3 cp /tmp/openapi_updated.json "s3://$BUCKET_NAME/openapi.json"

echo "Updated OpenAPI spec with CloudFront URL: $CLOUDFRONT_URL"
rm /tmp/openapi.json /tmp/openapi_updated.json

# Invoke AgentCore Gateway Lambda to create gateway
echo "Creating AgentCore Gateway..."
aws lambda invoke \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --payload '{"action":"create"}' \
    /tmp/lambda_response.json

if [ $? -eq 0 ]; then
    echo "AgentCore Gateway creation initiated"
    cat /tmp/lambda_response.json
    rm /tmp/lambda_response.json
else
    echo "Failed to invoke AgentCore Gateway Lambda"
fi

echo "OpenAPI update and AgentCore Gateway creation complete!"