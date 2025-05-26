"""
This is the main application for the container service.
"""
import os
import json
import time
import asyncio
import traceback
from contextlib import asynccontextmanager
import uuid

import nest_asyncio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from sse_starlette.sse import EventSourceResponse

from lambda_main.main import default_event_handler, lambda_handler
from lambda_main.main_utils.online_entries import get_entry
from shared.constant import EntryType
from shared.utils.logger_utils import get_logger
from fastapi_mcp import FastApiMCP
from authorize import require_auth

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

# Add authentication middleware
# app.add_middleware(AuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check for the containerservice"""
    return {"message": "OK"}

@app.post("/llm")
@require_auth
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
@require_auth
async def handle_stream_request(
    request: Request,
    query: str,
    entry_type: str = EntryType.COMMON,
    session_id: str = None,
    user_id: str = None,
    chatbot_config: str = None
):
    """Handle stream request"""
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

                class StreamingCallback:
                    """Streaming callback"""
                    def __init__(self):
                        self.collected_chunks = []

                    def on_llm_new_token(self, token, **kwargs):
                        """send chunk to client"""
                        logger.info(f"New token generated: {token}")
                        message = {
                            "event": "message",
                            "data": json.dumps({
                                "message_type": "CHUNK",
                                "message": {"content": token},
                                "created_time": time.time()
                            })
                        }
                        asyncio.create_task(message_queue.put(message))
                        self.collected_chunks.append(token)
                        return token

                callback = StreamingCallback()
                event_body["stream"] = True
                event_body["streaming_callback"] = callback

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
                    if event_body_orginal["query"] == "":
                        result = "empty query"
                    else:
                        result = entry_executor(event_body)
                    if isinstance(result, dict) and "answer" in result:
                        answer = result["answer"]
                        if hasattr(answer, '__iter__') and not isinstance(answer, str):
                            for item in answer:
                                if isinstance(item, dict) and item.get("message_type") == "MONITOR":
                                    message = {
                                        "event": "message",
                                        "data": json.dumps(item)
                                    }
                                    await message_queue.put(message)
                                    yield message

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
                    "event": "error",
                    "data": json.dumps({"error": error_info})
                }

        return EventSourceResponse(
            event_generator(),
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "*",
                "Transfer-Encoding": "chunked",
                "X-Content-Type-Options": "nosniff",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )

    except Exception as e:
        error_info = f'{type(e).__name__}: {e}'
        logger.error("%s\nAn error occurred: %s", traceback.format_exc(), error_info)
        return {"error": error_info}

@app.get("/ccp-stream")
@require_auth
async def handle_stream_request(
    request: Request,
    query: str,
    entry_type: str = EntryType.COMMON,
    session_id: str = None,
    user_id: str = None,
    chatbot_config: str = None
):
    """Handle ccp stream request"""
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

                class StreamingCallback:
                    """Streaming callback"""
                    def __init__(self):
                        self.collected_chunks = []

                    def on_llm_new_token(self, token, **kwargs):
                        """send chunk to client"""
                        logger.info(f"New token generated: {token}")
                        message = {
                            "event": "message",
                            "data": json.dumps({
                                "message_type": "CHUNK",
                                "message": {"content": token},
                                "created_time": time.time()
                            })
                        }
                        asyncio.create_task(message_queue.put(message))
                        self.collected_chunks.append(token)
                        return token

                callback = StreamingCallback()
                event_body["stream"] = True
                event_body["streaming_callback"] = callback

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
                    if event_body_orginal["query"] == "":
                        result = "empty query"
                    else:
                        result = entry_executor(event_body)
                    if isinstance(result, dict) and "answer" in result:
                        answer = result["answer"]
                        if hasattr(answer, '__iter__') and not isinstance(answer, str):
                            for item in answer:
                                if isinstance(item, dict) and item.get("message_type") == "MONITOR":
                                    message = {
                                        "event": "message",
                                        "data": json.dumps(item)
                                    }
                                    await message_queue.put(message)
                                    yield message

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
                    "event": "error",
                    "data": json.dumps({"error": error_info})
                }

        return EventSourceResponse(
            event_generator(),
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Methods": "*",
                "Transfer-Encoding": "chunked",
                "X-Content-Type-Options": "nosniff",
                "Pragma": "no-cache",
                "Expires": "0"
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
