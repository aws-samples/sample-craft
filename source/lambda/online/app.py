"""
This is the main application for the container service.
"""
import os
import json
import time
import asyncio
import traceback
from contextlib import asynccontextmanager

import nest_asyncio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from sse_starlette.sse import EventSourceResponse

from lambda_main.main import default_event_handler, lambda_handler
from lambda_main.main_utils.online_entries import get_entry
from shared.constant import EntryType
from shared.utils.logger_utils import get_logger
from fastapi_mcp import FastApiMCP

import shared.utils.sse_utils as sse_utils

HEARTBEAT_INTERVAL = 3

logger = get_logger("app")
nest_asyncio.apply()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan for the application"""
    current_loop = asyncio.get_running_loop()
    sse_utils.LOOP = current_loop
    yield

app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

@app.get("/health")
async def health_check():
    """Health check for the containerservice"""
    return {"message": "OK"}

@app.post("/llm")
async def handle_llm_request(request: Request):
    """Handle LLM request"""
    body = await request.body()
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



@app.get("/stream")
async def handle_stream_request(
    query: str,
    entry_type: str = EntryType.COMMON,
    session_id: str = None,
    user_id: str = None,
    chatbot_config: str = None
):
    client_id = sse_utils.sse_manager.connect()
    queue = sse_utils.sse_manager.get_client_queue(client_id)
    try:
        if chatbot_config:
            chatbot_config = json.loads(chatbot_config)
        else:
            chatbot_config = {}
        os.environ['GROUP_NAME'] = chatbot_config.get("group_name", "Admin")

        event_body_orginal = {
            "query": query,
            "entry_type": entry_type.lower(),
            "session_id": session_id,
            "user_id": user_id,
            "chatbot_config": chatbot_config,
            "stream": True
        }
        entry_executor = get_entry(entry_type.lower())
        async def event_generator():
            try:
                event_body = default_event_handler(event_body_orginal, {})
                message_queue = asyncio.Queue()

                def response_generator():
                    class StreamingCallback:
                        """Streaming callback"""
                        def __init__(self):
                            self.collected_chunks = []

                        def on_llm_new_token(self, token, **kwargs):
                            """send chunk to client"""
                            asyncio.run_coroutine_threadsafe(
                                message_queue.put({
                                    "data": json.dumps({
                                        "message_type": "CHUNK",
                                        "message": {"content": token},
                                        "created_time": time.time()
                                    })
                                }), sse_utils.LOOP
                            )
                            self.collected_chunks.append(token)
                            return token
                    
                    callback = StreamingCallback()
                    event_body["stream"] = True
                    event_body["streaming_callback"] = callback
                    
                    if event_body_orginal["query"] == "":
                        result = "empty query"
                    else:
                        result = entry_executor(event_body)

                    # 只推送 monitor 类型消息，chunk 只由 on_llm_new_token 推送
                    if hasattr(result, '__iter__') and not isinstance(result, (str, dict)):
                        for item in result:
                            if isinstance(item, dict) and item.get("message_type") == "MONITOR":
                                asyncio.run_coroutine_threadsafe(
                                    message_queue.put({
                                        "data": json.dumps(item)
                                    }), sse_utils.LOOP
                                )
                        return result
                    
                    if isinstance(result, str):
                        # 非 chunk 类型直接推送
                        asyncio.run_coroutine_threadsafe(
                            message_queue.put({
                                "data": json.dumps({
                                    "message_type": "INFO",
                                    "message": {"content": result},
                                    "created_time": time.time()
                                })
                            }), sse_utils.LOOP
                        )
                        return [result]
                    
                    if isinstance(result, dict) and "answer" in result:
                        answer = result["answer"]
                        if isinstance(answer, str):
                            asyncio.run_coroutine_threadsafe(
                                message_queue.put({
                                    "data": json.dumps({
                                        "message_type": "INFO",
                                        "message": {"content": answer},
                                        "created_time": time.time()
                                    })
                                }), sse_utils.LOOP
                            )
                            return [answer]
                        elif hasattr(answer, '__iter__') and not isinstance(answer, str):
                            for item in answer:
                                if isinstance(item, dict) and item.get("message_type") == "MONITOR":
                                    asyncio.run_coroutine_threadsafe(
                                        message_queue.put({
                                            "data": json.dumps(item)
                                        }), sse_utils.LOOP
                                    )
                            return answer            
                    if callback.collected_chunks:
                        return callback.collected_chunks
                    return [str(result)]

                response_generator()
                async def send_heartbeat():
                    while True:
                        await asyncio.sleep(HEARTBEAT_INTERVAL)
                        heartbeat_message = {
                            "event": "ping",
                            "data": json.dumps({"timestamp": time.time()})
                        }
                        await queue.put(heartbeat_message)

                heartbeat_task = asyncio.create_task(send_heartbeat())
                try:
                    while True:
                        try:
                            message = await asyncio.wait_for(message_queue.get(), timeout=0.1)
                            yield message
                        except asyncio.TimeoutError:
                            try:
                                message = await asyncio.wait_for(queue.get(), timeout=0.1)
                                yield message
                            except asyncio.TimeoutError:
                                continue
                finally:
                    heartbeat_task.cancel()
                    try:
                        await heartbeat_task
                    except asyncio.CancelledError:
                        pass
            except Exception as e:
                error_info = '{}: {}'.format(type(e).__name__, e)
                logger.error("%s\nAn error occurred: %s", traceback.format_exc(), error_info)
                yield {
                    "data": json.dumps({"error": error_info})
                }

        return EventSourceResponse(
            event_generator(),
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "*"
            }
        )

    except Exception as e:
        error_info = f'{type(e).__name__}: {e}'
        logger.error("%s\nAn error occurred: %s", traceback.format_exc(), error_info)
        return {"error": error_info}

mcp = FastApiMCP(
    app,
    name="MFG Knowledge Base MCP",
    description="MCP server for MFG Knowledge Base, providing an API for querying knowledge base entries.",
)
# Check the MCP information at https://host-url/mcp
mcp.mount()
