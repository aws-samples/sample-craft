#!/bin/bash

# Knowledge Base ETL Service - Local Startup Script

set -e

echo "🚀 Starting Knowledge Base ETL Service locally..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp .env.example .env
    echo "📝 Please edit .env file with your AWS configuration before continuing."
    echo "   Required variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AOS_ENDPOINT"
    exit 1
fi

# Create data directory if it doesn't exist
mkdir -p data

# Build and start the service
echo "🔨 Building and starting the service..."
docker-compose up --build -d

# Wait for service to be ready
echo "⏳ Waiting for service to be ready..."
sleep 10

# Check health
if curl -f http://localhost:8001/health > /dev/null 2>&1; then
    echo "✅ Service is running successfully!"
    echo ""
    echo "🌐 Service URLs:"
    echo "   API: http://localhost:8001"
    echo "   Health: http://localhost:8001/health"
    echo "   Docs: http://localhost:8001/docs"
    echo ""
    echo "📖 Example API call:"
    echo "   curl -X POST \"http://localhost:8001/etl/jobs\" \\"
    echo "     -H \"Content-Type: application/json\" \\"
    echo "     -d '{\"s3_bucket\": \"your-bucket\", \"s3_prefix\": \"docs/\", \"operation_type\": \"create\"}'"
    echo ""
    echo "📋 View logs: docker-compose logs -f job-service"
    echo "🛑 Stop service: docker-compose down"
else
    echo "❌ Service failed to start. Check logs:"
    docker-compose logs job-service
    exit 1
fi