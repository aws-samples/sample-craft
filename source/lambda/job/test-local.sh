#!/bin/bash

# Test script for local Knowledge Base ETL Service

set -e

echo "🧪 Testing Knowledge Base ETL Service..."

# Check if service is running
if ! curl -f http://localhost:8001/health > /dev/null 2>&1; then
    echo "❌ Service is not running. Please start it first with: docker-compose up -d"
    exit 1
fi

echo "✅ Service is running"

# Test health endpoint
echo "🔍 Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:8001/health)
echo "Health response: $HEALTH_RESPONSE"

# Test API documentation
echo "🔍 Testing API documentation..."
if curl -f http://localhost:8001/docs > /dev/null 2>&1; then
    echo "✅ API documentation is accessible at http://localhost:8001/docs"
else
    echo "⚠️  API documentation might not be accessible"
fi

# Test job creation (with mock data)
echo "🔍 Testing job creation..."
JOB_RESPONSE=$(curl -s -X POST "http://localhost:8001/etl/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "s3_bucket": "test-bucket",
    "s3_prefix": "test-docs/",
    "operation_type": "extract_only",
    "batch_file_number": "1",
    "batch_indice": "0",
    "document_language": "en",
    "qa_enhancement": "false",
    "offline": "true",
    "index_type": "qd"
  }')

echo "Job creation response: $JOB_RESPONSE"

# Extract job ID from response
JOB_ID=$(echo $JOB_RESPONSE | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$JOB_ID" ]; then
    echo "✅ Job created successfully with ID: $JOB_ID"
    
    # Wait a moment for job to process
    echo "⏳ Waiting for job to process..."
    sleep 5
    
    # Check job status
    echo "🔍 Checking job status..."
    STATUS_RESPONSE=$(curl -s "http://localhost:8001/etl/jobs/$JOB_ID")
    echo "Job status response: $STATUS_RESPONSE"
    
    # List all jobs
    echo "🔍 Listing all jobs..."
    JOBS_RESPONSE=$(curl -s "http://localhost:8001/etl/jobs")
    echo "All jobs response: $JOBS_RESPONSE"
    
    echo "✅ All tests completed successfully!"
else
    echo "❌ Failed to create job"
    exit 1
fi

echo ""
echo "🎉 Local ETL service is working correctly!"
echo "📖 You can now use the service with your own S3 buckets and data."