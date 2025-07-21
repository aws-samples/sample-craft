# Knowledge Base ETL Service - Local Docker Setup

This guide helps you run the Knowledge Base ETL service locally using Docker Compose.

## Prerequisites

- Docker and Docker Compose installed
- AWS credentials configured
- Access to required AWS services (S3, OpenSearch, DynamoDB)

## Quick Start

1. **Copy environment file**:
   ```bash
   cp .env.example .env
   ```

2. **Configure environment variables** in `.env`:
   - Set your AWS credentials
   - Configure OpenSearch endpoint
   - Set S3 bucket names
   - Configure DynamoDB table names

3. **Create data directory**:
   ```bash
   mkdir -p data
   ```

4. **Start the service**:
   ```bash
   docker-compose up --build
   ```

5. **Access the service**:
   - API: http://localhost:8001
   - Health check: http://localhost:8001/health
   - API docs: http://localhost:8001/docs

## API Usage

### Create ETL Job

```bash
curl -X POST "http://localhost:8001/etl/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "s3_bucket": "your-source-bucket",
    "s3_prefix": "documents/",
    "operation_type": "create",
    "batch_file_number": "10",
    "batch_indice": "0",
    "document_language": "en",
    "qa_enhancement": "false",
    "offline": "true",
    "index_type": "qd"
  }'
```

### Check Job Status

```bash
curl "http://localhost:8001/etl/jobs/{job_id}"
```

### List All Jobs

```bash
curl "http://localhost:8001/etl/jobs"
```

## Operation Types

- `create`: Process and ingest new documents
- `update`: Delete existing documents and re-ingest
- `delete`: Remove documents from the index
- `extract_only`: Process documents without ingesting to OpenSearch

## Supported File Types

- PDF: `.pdf`
- Text: `.txt`, `.md`
- Documents: `.docx`
- Spreadsheets: `.xlsx`, `.xls`, `.csv`
- Web: `.html`
- Data: `.json`
- Images: `.png`, `.jpeg`, `.jpg`, `.webp`

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region | `us-east-1` |
| `AOS_ENDPOINT` | OpenSearch endpoint | Required |
| `RES_BUCKET` | Result storage bucket | Required |
| `ETL_OBJECT_TABLE` | DynamoDB table for job tracking | Required |
| `MODEL_TABLE` | DynamoDB table for model config | Required |
| `CHATBOT_ID` | Chatbot identifier | `default-chatbot` |
| `INDEX_ID` | OpenSearch index name | `default-index` |
| `GROUP_NAME` | Group name for model lookup | `default-group` |

### Local Development Features

- Mock implementations for missing AWS services
- Graceful error handling for unavailable resources
- Detailed logging for debugging
- Health check endpoint

## Troubleshooting

### Common Issues

1. **AWS Credentials**: Ensure your AWS credentials are properly configured
2. **Network Access**: Verify connectivity to AWS services
3. **Permissions**: Check IAM permissions for S3, OpenSearch, and DynamoDB
4. **Dependencies**: Some advanced features may require additional setup

### Logs

View service logs:
```bash
docker-compose logs -f job-service
```

### Development Mode

For development with code changes:
```bash
docker-compose up --build
```

## Architecture

The service consists of:
- **FastAPI Application**: REST API for job management
- **ETL Pipeline**: Document processing and ingestion
- **Background Tasks**: Asynchronous job execution
- **Mock Services**: Local development support

## Limitations

- In-memory job status storage (use Redis/DynamoDB for production)
- Simplified error handling for local development
- Some advanced features may require full AWS environment