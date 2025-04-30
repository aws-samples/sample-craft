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
from fastapi_mcp import FastApiMCP


logger = get_logger("app")
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
    return lambda_handler(event, None)


@app.post("/stream")
async def handle_stream_request(request: Request):
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
                "model_id": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
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
            # Process the event body once
            event_body = default_event_handler(event_body, {})
            
            # Create a generator that will yield chunks of the response
            def response_generator():
                
                # Create a custom callback to capture chunks
                class StreamingCallback:
                    def __init__(self):
                        self.collected_chunks = []
                    
                    def on_llm_new_token(self, token, **kwargs):
                        self.collected_chunks.append(token)
                        return token
                
                callback = StreamingCallback()
                
                # Set streaming flag and callback
                event_body["stream"] = True
                event_body["streaming_callback"] = callback
                
                # Execute the entry and get the result
                result = entry_executor(event_body)
                
                # If result is already a generator, return it directly
                if hasattr(result, '__iter__') and not isinstance(result, (str, dict)):
                    return result
                
                # If result is a string, yield it as a single chunk
                if isinstance(result, str):
                    return [result]
                
                # If result is a dict with an answer field, yield that
                if isinstance(result, dict) and "answer" in result:
                    answer = result["answer"]
                    if isinstance(answer, str):
                        return [answer]
                    elif hasattr(answer, '__iter__') and not isinstance(answer, str):
                        return answer
                
                # Default case: return the collected chunks or the result as a string
                if callback.collected_chunks:
                    return callback.collected_chunks
                return [str(result)]
            
            # Get the response generator
            response_iter = response_generator()
            
            # Stream each chunk as an SSE event
            for chunk in response_iter:
                yield {
                    "event": "message",
                    "data": json.dumps({"answer": chunk, "extra_response": {}})
                }
            
            # Send completion event
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


mcp = FastApiMCP(
    app,  
    name="MFG Knowledge Base MCP",
    description="MCP server for MFG Knowledge Base, providing an API for querying knowledge base entries.",
)
# Check the MCP information at https://host-url/mcp
mcp.mount()


