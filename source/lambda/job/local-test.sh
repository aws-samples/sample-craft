#!/bin/bash

# Stop and remove any existing containers
docker-compose down

# Build and start the container (force rebuild without cache)
docker-compose up -d --build --force-recreate
# docker-compose up --build

echo "Lambda container is running at http://localhost:9000"
echo "Waiting for container to be ready..."
sleep 5

echo "Testing environment variables..."
docker-compose exec lambda-rie python test_env.py

echo "\nYou can invoke the Lambda function with:"
echo "curl -XPOST \"http://localhost:9000/2015-03-31/functions/function/invocations\" -d '{\"httpMethod\": \"POST\", \"body\": \"{\\\"s3_bucket\\\": \\\"your-bucket\\\", \\\"s3_prefix\\\": \\\"your-prefix\\\", \\\"operation_type\\\": \\\"extract_only\\\"}\"}'"

# Wait for user to press a key
read -p "Press any key to stop the container..."

# Stop the container
docker-compose down