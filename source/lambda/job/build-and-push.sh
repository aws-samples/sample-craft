#!/bin/bash

# Build and push Docker image to ECR
# Usage: ./build-and-push.sh <aws-account-id> <region> <repository-name>

set -e

AWS_ACCOUNT_ID=${1:-$(aws sts get-caller-identity --query Account --output text)}
REGION=${2:-us-east-1}
REPOSITORY_NAME=${3:-knowledge-base-etl}

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY_NAME}"

echo "Building Docker image..."
docker build -t ${REPOSITORY_NAME} .

echo "Tagging image..."
docker tag ${REPOSITORY_NAME}:latest ${ECR_URI}:latest

echo "Logging in to ECR..."
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ECR_URI}

echo "Pushing image to ECR..."
docker push ${ECR_URI}:latest

echo "Image pushed successfully to ${ECR_URI}:latest"