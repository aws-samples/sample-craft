#!/bin/bash

set -e

echo "Starting CDK deployment..."

# Navigate to infrastructure directory and deploy
cd ../source/infrastructure
npx cdk deploy --require-approval never --all

echo "CDK deployment completed. Getting stack outputs..."

# Get stack name ending with 'craft'
STACK_NAME=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[?ends_with(StackName, 'craft')].StackName" --output text | head -1)

if [ -z "$STACK_NAME" ]; then
    echo "Error: Could not find stack ending with 'craft'."
    exit 1
fi

echo "Found stack: $STACK_NAME"

# Debug: Show all stack outputs
echo "Available stack outputs:"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}" --output table

# Get bucket name, lambda function name, and CloudFront URL from stack outputs using keywords
BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?contains(OutputKey, 'BucketName')].OutputValue" --output text)
LAMBDA_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?contains(OutputKey, 'LambdaName')].OutputValue" --output text)
CLOUDFRONT_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?contains(OutputKey, 'CloudFrontURL')].OutputValue" --output text)

if [ -z "$BUCKET_NAME" ] || [ -z "$LAMBDA_NAME" ] || [ -z "$CLOUDFRONT_URL" ]; then
    echo "Error: Could not retrieve required parameters from stack outputs"
    echo "Bucket name: $BUCKET_NAME"
    echo "Lambda name: $LAMBDA_NAME"
    echo "CloudFront URL: $CLOUDFRONT_URL"
    exit 1
fi

echo "Retrieved parameters:"
echo "  S3 Bucket: $BUCKET_NAME"
echo "  Lambda Function: $LAMBDA_NAME"
echo "  CloudFront URL: $CLOUDFRONT_URL"

# Navigate back to deployment directory and run setup script
cd ../../deployment
echo "Running HTTPS and Gateway setup..."
./setup.sh "$BUCKET_NAME" "$LAMBDA_NAME" "$CLOUDFRONT_URL"

echo "Deployment completed successfully!"