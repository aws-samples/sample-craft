# import asyncio
import enum
import functools
import importlib
import json
import time
import os
import threading
import requests
from typing import Any, Dict, Optional, Callable, Union

from shared.constant import StreamMessageType
from .logger_utils import get_logger
from pydantic import BaseModel, Field, model_validator
from shared.utils.sse_utils import sse_manager
from common_logic.common_utils.response_utils import send_message

from ..exceptions import LambdaInvokeError
import contextvars

state_context_var = contextvars.ContextVar('state_context_var', default=None)

logger = get_logger("lambda_invoke_utils")
thread_local = threading.local()
CURRENT_STATE = None

__FUNC_NAME_MAP = {
    "query_preprocess": "Preprocess for Multi-round Conversation",
    "intention_detection": "Intention Detection",
    "agent": "Agent",
    "tools_choose_and_results_generation": "Tool Calling",
    "results_evaluation": "Result Evaluation",
    "tool_execution": "Final Tool Result",
    "llm_direct_results_generation": "LLM Response"
}


class StateContext:

    def __init__(self, state):
        self.state = state

    @classmethod
    def get_current_state(cls):
        state = state_context_var.get() 
        # assert state is not None, "There is not a valid state in current context"
        return state

    @classmethod
    def set_current_state(cls, state):
        # assert state_context_var.get() is None, "Parallel node executions are not alowed"
        state_context_var.set(state)
      
    @classmethod
    def clear_state(cls):
        state_context_var.set(None)

    def __enter__(self):
        self.set_current_state(self.state)

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.clear_state()

class LAMBDA_INVOKE_MODE(enum.Enum):
    LAMBDA = "lambda"
    LOCAL = "local"
    API_GW = "api_gw"

    @classmethod
    def has_value(cls, value):
        return value in cls._value2member_map_

    @classmethod
    def values(cls):
        return [e.value for e in cls]


_lambda_invoke_mode = LAMBDA_INVOKE_MODE.LOCAL.value

_is_current_invoke_local = False
_current_stream_use = True
# _ws_connection_id = None
_enable_trace = True
# _is_main_lambda = True


class LambdaInvoker(BaseModel):
    client: Any = None
    region_name: str = None
    credentials_profile_name: Optional[str] = Field(default=None, exclude=True)

    @model_validator(mode="before")
    def validate_environment(cls, values: Dict):
        if values.get("client") is not None:
            return values
        try:
            import boto3
            try:
                if values.get("credentials_profile_name") is not None:
                    session = boto3.Session(
                        profile_name=values["credentials_profile_name"]
                    )
                else:
                    # use default credentials
                    session = boto3.Session()
                values["client"] = session.client(
                    "lambda",
                    region_name=values.get(
                        "region_name", os.environ['AWS_REGION'])
                )
            except Exception as e:
                raise ValueError(
                    "Could not load credentials to authenticate with AWS client. "
                    "Please check that credentials in the specified "
                    f"profile name are valid. {e}"
                ) from e

        except ImportError:
            raise ImportError(
                "Could not import boto3 python package. "
                "Please install it with `pip install boto3`."
            )
        return values

    def invoke_with_lambda(self, lambda_name: str, event_body: dict):
        invoke_response = self.client.invoke(
            FunctionName=lambda_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(event_body),
        )
        response_body = invoke_response["Payload"]
        response_str = response_body.read().decode()
        response_body = json.loads(response_str)
        if "body" in response_body:
            response_body = json.loads(response_body['body'])

        if "errorType" in response_body:
            error = (
                f"{lambda_name} invoke failed\n\n"
                + "".join(response_body["stackTrace"])
                + "\n"
                + f"{response_body['errorType']}: {response_body['errorMessage']}"
            )
            raise LambdaInvokeError(error)
        return response_body

    def invoke_with_local(
        self,
        lambda_module_path: Union[str, Callable],
        event_body: dict,
        handler_name="lambda_handler"
    ):
        if callable(lambda_module_path):
            lambda_fn = lambda_module_path
        else:
            lambda_module = importlib.import_module(lambda_module_path)
            lambda_fn = getattr(lambda_module, handler_name)
        ret = lambda_fn(event_body)
        return ret

    def invoke_with_apigateway(self, url, event_body: dict):
        r = requests.post(url, json=event_body)
        data = r.json()
        if r.status_code != 200:
            raise LambdaInvokeError(str(data))

        ret = json.loads(data["body"])
        return ret

    def invoke_lambda(
        self,
        event_body,
        lambda_invoke_mode: LAMBDA_INVOKE_MODE = None,
        lambda_name=None,
        lambda_module_path=None,
        handler_name="lambda_handler",
        apigetway_url=None,
    ):
        lambda_invoke_mode = lambda_invoke_mode or _lambda_invoke_mode

        assert LAMBDA_INVOKE_MODE.has_value(lambda_invoke_mode), (
            lambda_invoke_mode,
            LAMBDA_INVOKE_MODE.values(),
        )

        if lambda_invoke_mode == LAMBDA_INVOKE_MODE.LAMBDA.value:
            return self.invoke_with_lambda(
                lambda_name=lambda_name, event_body=event_body
            )
        elif lambda_invoke_mode == LAMBDA_INVOKE_MODE.LOCAL.value:
            return self.invoke_with_local(
                lambda_module_path=lambda_module_path,
                event_body=event_body,
                handler_name=handler_name,
            )
        elif lambda_invoke_mode == LAMBDA_INVOKE_MODE.API_GW.value:
            return self.invoke_with_apigateway(url=apigetway_url, event_body=event_body)


obj = LambdaInvoker()
invoke_with_local = obj.invoke_with_local
invoke_with_lambda = obj.invoke_with_lambda
invoke_with_apigateway = obj.invoke_with_apigateway
invoke_lambda = obj.invoke_lambda

def is_running_local():
    return _is_current_invoke_local

def send_trace(
    trace_info: str,
    current_stream_use: Union[bool, None] = None,
    connection_id: Optional[str] = None,
    enable_trace: Union[bool, None] = None,
    response = None
) -> None:
    """Send trace info to client."""
    if current_stream_use is None:
        current_stream_use = _current_stream_use
    if enable_trace is None:
        enable_trace = _enable_trace
    if not current_stream_use or not enable_trace:
        return

    if connection_id is None:
        connection_id = sse_manager.get_current_client_id()
        if connection_id is None:
            logger.warning("No client ID available for sending trace message")
            return

    message = {
        "message_type": StreamMessageType.MONITOR,
        "message": trace_info,
        "created_time": time.time(),
    }
    send_message(message, connection_id)


def node_monitor_wrapper(fn: Optional[Callable[..., Any]] = None, *, monitor_key: str = "current_monitor_infos") -> Callable[..., Any]:
    """
    A decorator to monitor the execution of a node function.
    """
    def inner(func: Callable[..., Any]) -> Callable[..., Dict[str, Any]]:
        @functools.wraps(func)
        def wrapper(state: Dict[str, Any]) -> Dict[str, Any]:
            enter_time = time.time()
            current_stream_use = state["stream"]
            enable_trace = state["enable_trace"]
            send_trace(f"\n\n ### {__FUNC_NAME_MAP.get(func.__name__, func.__name__)}\n\n",
                       current_stream_use, None, enable_trace)
            state['trace_infos'].append(
                f"Enter: {func.__name__}, time: {time.time()}")

            with StateContext(state):
                output = func(state)

            current_monitor_infos = output.get(monitor_key, None)
            if current_monitor_infos is not None:
                send_trace(f"\n\n {current_monitor_infos}",
                           current_stream_use, None, enable_trace)
            exit_time = time.time()
            state['trace_infos'].append(
                f"Exit: {func.__name__}, time: {time.time()}")
            send_trace(f"\n\n Elapsed time: {round((exit_time-enter_time)*100)/100} s",
                       current_stream_use, None, enable_trace)
            return output

        return wrapper

    if fn is not None:
        assert callable(fn), fn
    if callable(fn):
        return inner(fn)
    return inner
