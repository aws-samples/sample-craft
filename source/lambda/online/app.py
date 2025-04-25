from fastapi import FastAPI, Request
from lambda_main.main import lambda_handler
import json
import nest_asyncio
nest_asyncio.apply()

app = FastAPI()


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/llm")
async def handle_llm_request(request: Request):
    # Get the raw request body
    body = await request.body()
    
    # Create a Lambda-like event
    event = {
        "body": body.decode(),
        "headers": dict(request.headers),
        "requestContext": {
            "http": {
                "method": "POST",
                "path": "/llm"
            }
        }
    }
    
    # Call the Lambda handler
    response = lambda_handler(event, None)
    
    # Return the response
    return json.loads(response.get("body", "{}"))
