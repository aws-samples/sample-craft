#!/bin/bash

# Build and start the container
docker-compose up -d

echo "Lambda container is running at http://localhost:9000"
echo "Waiting for container to be ready..."
sleep 5

echo "You can invoke the Lambda function with:"
echo "curl -XPOST \"http://localhost:9000/2015-03-31/functions/function/invocations\" -d '{\"httpMethod\": \"POST\", \"body\": \"{\\\"s3_bucket\\\": \\\"your-bucket\\\", \\\"s3_prefix\\\": \\\"your-prefix\\\", \\\"operation_type\\\": \\\"extract_only\\\"}\"}'"

# Wait for user to press a key
read -p "Press any key to stop the container..."

# Stop the container
docker-compose down