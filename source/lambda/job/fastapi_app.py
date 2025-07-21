from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import os
import sys
import logging
from datetime import datetime, timezone

# Add the current directory to Python path to import the glue job modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import main

app = FastAPI(title="Knowledge Base ETL Service", version="1.0.0")

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

class ETLJobRequest(BaseModel):
    s3_bucket: str = None
    s3_prefix: str = None
    operation_type: str = None
    batch_file_number: str = None
    batch_indice: str = None
    document_language: str = None
    qa_enhancement: str = None
    index_type: str = None
    aos_endpoint: str = None
    etl_endpoint_name: str = None
    etl_object_table_name: str = None
    portal_bucket_name: str = None
    bedrock_region: str = None
    res_bucket: str = None
    aos_index_name: str = None

def get_param_value(request_val, env_key, default_val):
    """Get parameter value with priority: request -> env -> default"""
    if request_val is not None:
        return request_val
    return os.getenv(env_key, default_val)

class ETLJobResponse(BaseModel):
    job_id: str
    status: str
    message: str

# Store job status in memory (in production, use Redis or DynamoDB)
job_status = {}

def run_etl_job(job_id: str, request: ETLJobRequest):
    """Run ETL job in background"""
    try:
        job_status[job_id] = {"status": "RUNNING", "start_time": datetime.now(timezone.utc)}
        
        # Pass request and job_id directly to main function
        
        main(request, job_id)
        
        job_status[job_id] = {
            "status": "COMPLETED", 
            "start_time": job_status[job_id]["start_time"],
            "end_time": datetime.now(timezone.utc)
        }
        
    except Exception as e:
        logger.error(f"Job {job_id} failed: {str(e)}")
        job_status[job_id] = {
            "status": "FAILED", 
            "error": str(e),
            "start_time": job_status[job_id]["start_time"],
            "end_time": datetime.now(timezone.utc)
        }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

@app.post("/etl/jobs", response_model=ETLJobResponse)
async def create_etl_job(request: ETLJobRequest, background_tasks: BackgroundTasks):
    """Create and start an ETL job"""
    job_id = f"job-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{hash(str(request)) % 10000}"
    
    # Add job to background tasks
    background_tasks.add_task(run_etl_job, job_id, request)
    
    return ETLJobResponse(
        job_id=job_id,
        status="SUBMITTED",
        message="ETL job submitted successfully"
    )

@app.get("/etl/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get job status"""
    if job_id not in job_status:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "job_id": job_id,
        **job_status[job_id]
    }

@app.get("/etl/jobs")
async def list_jobs():
    """List all jobs"""
    return {
        "jobs": [
            {"job_id": job_id, **status} 
            for job_id, status in job_status.items()
        ]
    }



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)