import os
import traceback
from fastapi import FastAPI, Request
from lambda_main.main import default_event_handler, lambda_handler
import json
import nest_asyncio
from shared.constant import EntryType
from sse_starlette.sse import EventSourceResponse
from lambda_main.main_utils.online_entries import get_entry
from shared.utils.logger_utils import get_logger

nest_asyncio.apply()
app = FastAPI()
logger = get_logger("app")

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

@app.post("/stream")
async def handle_llm_request(request: Request):
    body = await request.body()
    event_body = {
        "query": "什么是伦敦金",
        "entry_type": "common",
        "session_id": "834f1da6-03b1-44d6-b5b2-1cd9e121b6f7",
        "user_id": "example@example.com",
        "stream": True,
        "chatbot_config": {
            "max_rounds_in_memory": 7,
            "group_name": "Admin",
            "chatbot_id": "admin",
            "chatbot_mode": "agent",
            "use_history": True,
            "enable_trace": True,
            "use_websearch": True,
            "google_api_key": "",
            "default_llm_config": {
                "model_id": "us.amazon.nova-pro-v1:0",
                "endpoint_name": "",
                "provider": "Bedrock",
                "base_url": "",
                "api_key_arn": "",
                "model_kwargs": {
                    "temperature": 0.01,
                    "max_tokens": 1000
                }
            },
            "default_retriever_config": {
                "private_knowledge": {
                    "bm25_search_top_k": 5,
                    "bm25_search_score": 0.4,
                    "vector_search_top_k": 5,
                    "vector_search_score": 0.4,
                    "rerank_top_k": 10
                }
            },
            "agent_config": {
                "only_use_rag_tool": False
            }
        }
    }
    os.environ['GROUP_NAME'] = event_body.get(
        "chatbot_config", {}).get("group_name", "Admin")
    
    entry_type = event_body.get("entry_type", EntryType.COMMON).lower()
    entry_executor = get_entry(entry_type)
    stream = event_body.get("stream")
    
    async def event_generator(event_body: dict):
        try:
            event_body = default_event_handler(event_body, {})
            result = entry_executor(event_body)
            if hasattr(result, '__aiter__'):
                print("has aiter")
                async for chunk in result:
                    if isinstance(chunk, dict):
                        yield {
                            "event": "message",
                            "data": json.dumps(chunk)
                        }
            else:
                print("has not aiter, it is a string")
                yield {
                    "event": "message",
                    "data": json.dumps({"answer": result, "extra_response": {}})
                }
            yield {
                "event": "complete",
                "data": json.dumps({"status": "completed"})
            }
        except Exception as e:
            error_info = '{}: {}'.format(type(e).__name__, e)
            error_response = {"answer": error_info, "extra_response": {}}
            enable_trace = event_body.get(
                "chatbot_config", {}).get("enable_trace", True)
            error_trace = f"\n### Error trace\n\n{traceback.format_exc()}\n\n"
            logger.error(f"{traceback.format_exc()}\nAn error occurred: {error_info}")
            # return {"error": error_info}
            yield {
                "event": "error",
                "data": error_info
            }
    
    return EventSourceResponse(event_generator(event_body))
