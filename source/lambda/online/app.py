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
    """
    Handle synchronous LLM requests for text generation and processing.

    This endpoint processes LLM requests in a non-streaming fashion, suitable for
    shorter interactions or when immediate complete responses are needed.

    Parameters:
        request (Request): The FastAPI request object containing:
            - body: JSON payload with the query and configuration
            - headers: Request headers including authentication

    Request Body Schema:
        {
            "query": str,              # The input text/prompt for the LLM
            "entry_type": str,         # Type of entry (default: "common")
            "session_id": str,         # Optional session identifier
            "user_id": str,           # Optional user identifier
            "chatbot_config": dict    # Optional LLM configuration parameters
        }

    Returns:
        dict: The LLM response containing generated text and metadata

    Authentication:
        Requires valid authentication token in request headers
    """
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
    """
    Handle streaming LLM requests with Server-Sent Events (SSE) for real-time text generation.

    This endpoint enables streaming responses from the LLM, sending tokens as they're
    generated and maintaining a persistent connection with heartbeat messages.

    Parameters:
        request (Request): The FastAPI request object
        query (str): The input text/prompt for the LLM
        entry_type (str, optional): Type of entry processing (default: COMMON)
        session_id (str, optional): Unique identifier for the chat session
        user_id (str, optional): Identifier for the user making the request
        chatbot_config (str, optional): JSON string containing LLM configuration:
            {
                "group_name": str,     # Group name for access control
                "model_name": str,     # Specific LLM model to use
                "temperature": float,  # LLM temperature setting
                ... # Other model-specific parameters
            }

    Returns:
        EventSourceResponse: SSE response stream containing:
            - message events: {"message_type": "CHUNK", "message": {"content": str}}
            - ping events: {"timestamp": float} (every HEARTBEAT_INTERVAL seconds)
            - error events: {"error": str} (if an error occurs)

    Events:
        - "message": Contains generated text chunks or monitoring data
        - "ping": Heartbeat messages to maintain connection
        - "error": Error information if processing fails

    Authentication:
        Requires valid authentication token in request headers

    Notes:
        - Maintains connection with periodic heartbeats (every 3 seconds)
        - Supports monitoring events for tracking generation progress
        - Handles empty queries and various error conditions
        - Implements CORS and other security headers
    """
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
