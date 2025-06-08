"""Response utils"""
import json
import time
import traceback
import types

from common_logic.common_utils.ddb_utils import DynamoDBChatMessageHistory
from shared.constant import StreamMessageType
from shared.utils.logger_utils import get_logger
from shared.utils.sse_utils import sse_manager

logger = get_logger("response_utils")

class SSEClientError(Exception):
    """SSE client error"""

def write_chat_history_to_ddb(
    query: str,
    answer: str,
    ddb_obj: DynamoDBChatMessageHistory,
    message_id,
    custom_message_id,
    entry_type,
    additional_kwargs=None,
):
    """Write chat history to DDB"""
    ddb_obj.add_user_message(
        f"user_{message_id}",
        custom_message_id,
        entry_type,
        query,
        additional_kwargs,
    )
    ddb_obj.add_ai_message(
        f"ai_{message_id}",
        custom_message_id,
        entry_type,
        answer,
        input_message_id=f"user_{message_id}",
        additional_kwargs=additional_kwargs,
    )


def api_response(event_body: dict, response: dict):
    """API response"""
    ddb_history_obj = event_body["ddb_history_obj"]
    answer = response["answer"]
    if isinstance(answer, types.GeneratorType):
        answer = ''.join(answer)
    elif not isinstance(answer, str):
        answer = json.dumps(answer, ensure_ascii=False)

    write_chat_history_to_ddb(
        query=event_body["query"],
        answer=answer,
        ddb_obj=ddb_history_obj,
        message_id=event_body["message_id"],
        custom_message_id=event_body["custom_message_id"],
        entry_type=event_body["entry_type"],
        additional_kwargs=response.get("ddb_additional_kwargs", {}),
    )

    return {
        "session_id": event_body["session_id"],
        "entry_type": event_body["entry_type"],
        "created": time.time(),
        "total_time": time.time() - event_body["request_timestamp"],
        "message": {"role": "assistant", "content": answer},
        **response["extra_response"],
    }

def stream_response(event_body: dict, response: dict):
    """Stream response"""
    entry_type = event_body["entry_type"]
    message_id = event_body["message_id"]
    custom_message_id = event_body["custom_message_id"]
    answer = response["answer"]
    if isinstance(answer, str):
        answer = iter([answer])
    elif not hasattr(answer, '__iter__'):
        answer = iter([str(answer)])

    ddb_history_obj = event_body["ddb_history_obj"]
    answer_str = ""
    client_id = event_body.get("client_id")

    try:
        if client_id:
            send_message({
                "message_type": StreamMessageType.START,
                "message_id": f"ai_{message_id}",
                "custom_message_id": custom_message_id,
            }, client_id)

        for i, chunk in enumerate(answer or []):
            if client_id:
                send_message({
                    "message_type": StreamMessageType.CHUNK,
                    "message_id": f"ai_{message_id}",
                    "custom_message_id": custom_message_id,
                    "message": {
                        "role": "assistant",
                        "content": str(chunk),
                    },
                    "chunk_id": i,
                }, client_id)
            answer_str += str(chunk)

        write_chat_history_to_ddb(
            query=event_body["query"],
            answer=answer_str,
            ddb_obj=ddb_history_obj,
            message_id=message_id,
            custom_message_id=custom_message_id,
            entry_type=entry_type,
            additional_kwargs=response.get("ddb_additional_kwargs", {}),
        )

        # Send context message if available
        if response and client_id:
            context_msg = {
                "message_type": StreamMessageType.CONTEXT,
                "message_id": f"ai_{message_id}",
                "custom_message_id": custom_message_id,
                "ddb_additional_kwargs": {},
            }

            figure = response.get("extra_response", {}).get("ref_figures", [])
            if figure:
                context_msg["ddb_additional_kwargs"]["figure"] = figure
            ref_doc = response.get("extra_response", {}).get("ref_docs", [])
            print(f"################# ref_doc is {ref_doc}")
            if ref_doc:
                md_images = []
                md_image_list = []
                for doc in ref_doc:
                    doc_content = doc.page_content
                    for line in doc_content.split('\n'):
                        img_start = line.find("![")
                        while img_start != -1:
                            try:
                                alt_end = line.find("](", img_start)
                                img_end = line.find(")", alt_end)

                                if alt_end != -1 and img_end != -1:
                                    image_path = line[alt_end + 2:img_end]
                                    if '"' in image_path or "'" in image_path:
                                        image_path = image_path.split(
                                            '"')[0].split("'")[0].strip()
                                    if image_path:
                                        have_same_image = False
                                        for md_image_item in md_image_list:
                                            if image_path in md_image_item:
                                                have_same_image = True

                                        md_image_json = {
                                            "content_type": "md_image",
                                            "figure_path": image_path
                                        }
                                        if not have_same_image and md_image_json not in md_images:
                                            md_images.append(md_image_json)
                                            md_image_list.append(image_path)
                                img_start = line.find("![", img_start + 2)
                            except Exception as e:
                                logger.error(
                                    f"Error processing markdown image: {str(e)}, in line: {line}")
                                img_start = line.find("![", img_start + 2)
                                continue
                context_msg["ddb_additional_kwargs"]["ref_docs"] = ref_doc
                if md_images:
                    context_msg["ddb_additional_kwargs"].setdefault(
                        "figure", []).extend(md_images)

            send_message(context_msg, client_id)
            send_message({
                "message_type": StreamMessageType.END,
                "message_id": f"ai_{message_id}",
                "custom_message_id": custom_message_id,
            }, client_id)
    except SSEClientError:
        error = traceback.format_exc()
        logger.info(error)
    except Exception:
        error = traceback.format_exc()
        logger.info(error)
        if client_id:
            send_message({
                "message_type": StreamMessageType.ERROR,
                "message_id": f"ai_{message_id}",
                "custom_message_id": custom_message_id,
                "message": {"content": error},
            }, client_id)
    return answer_str

def process_response(event_body, response):
    """define process response"""
    stream = event_body.get("stream", True)
    if stream:
        return stream_response(event_body, response)

    return api_response(event_body, response)

def send_message(message: dict, client_id: str = None):
    """Send message to client."""
    if client_id is None:
        client_id = sse_manager.get_current_client_id()

    # Format message for ServerSentEvent
    if isinstance(message, dict):
        if message.get("event") == "ping":
            # For ping messages, send as is without additional formatting
            formatted_message = message
        elif "message_type" in message:
            formatted_message = {
                "event": "message",
                "data": json.dumps(message)
            }
        else:
            formatted_message = message
    else:
        formatted_message = {
            "event": "message",
            "data": json.dumps({"content": str(message)})
        }

    sse_manager.send_message(formatted_message, client_id)

def handle_stream_response(event_body, response):
    """Handle stream response."""
    client_id = sse_manager.get_current_client_id()
    if not client_id:
        return api_response(event_body, response)

    try:
        for chunk in response:
            if isinstance(chunk, str):
                message = {
                    "event": "message",
                    "data": json.dumps({
                        "message_type": "CHUNK",
                        "message": {"content": chunk},
                        "created_time": time.time()
                    })
                }
                send_message(message, client_id)
            elif isinstance(chunk, dict):
                message = {
                    "event": "message",
                    "data": json.dumps({
                        "message_type": "CHUNK",
                        "message": chunk,
                        "created_time": time.time()
                    })
                }
                send_message(message, client_id)
    except Exception as e:
        error_message = {
            "event": "error",
            "data": json.dumps({
                "error": str(e),
                "created_time": time.time()
            })
        }
        send_message(error_message, client_id)

    return api_response(event_body, response)

def handle_context_response(event_body, response):
    """Handle context response."""
    client_id = sse_manager.get_current_client_id()
    if not client_id:
        return api_response(event_body, response)

    try:
        context_msg = {
            "event": "message",
            "data": json.dumps({
                "message_type": "CONTEXT",
                "message": response.get("context", {}),
                "created_time": time.time()
            })
        }
        send_message(context_msg, client_id)

        message = {
            "event": "message",
            "data": json.dumps({
                "message_type": "CHUNK",
                "message": {"content": response.get("response", "")},
                "created_time": time.time()
            })
        }
        send_message(message, client_id)
    except Exception as e:
        error_message = {
            "event": "error",
            "data": json.dumps({
                "error": str(e),
                "created_time": time.time()
            })
        }
        send_message(error_message, client_id)

    return api_response(event_body, response)
