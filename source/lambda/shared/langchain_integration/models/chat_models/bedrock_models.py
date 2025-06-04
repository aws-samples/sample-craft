import os
import boto3
from langchain_aws.chat_models.bedrock_converse import (
    ChatBedrockConverse as _ChatBedrockConverse,
    _messages_to_bedrock,
    _snake_to_camel_keys,
    _parse_response,
    _parse_stream_event
)
from shared.constant import (
    MessageType,
    LLMModelType,
    ModelProvider
)
from typing import List,Optional,Iterator
from shared.utils.logger_utils import (
    get_logger,
    llm_messages_print_decorator
)
import copy
from . import (
    ChatModelBase,
    BedrockConverseReasonModelResult,
    BedrockConverseReasonModelStreamResult
)
from langchain_core.messages import BaseMessage
from ..model_config import (
    BEDROCK_MODEL_CONFIGS
)
from pydantic import Field
from typing import Any
from shared.utils.boto3_utils import get_boto3_client
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.callbacks import CallbackManagerForLLMRun

logger = get_logger("bedrock_model")

class ChatBedrockConverse(_ChatBedrockConverse):
    enable_any_tool_choice: bool = False
    any_tool_choice_value: str = 'any'
    enable_prefill: bool = True
    is_reasoning_model: bool = False
    reason_model_result_cls:Any = BedrockConverseReasonModelResult
    reason_model_result_cls_init_kwargs:dict = Field(default_factory=dict)
    reason_model_stream_result_cls: Any = BedrockConverseReasonModelStreamResult
    reason_model_stream_result_cls_init_kwargs:dict = Field(default_factory=dict)
    support_prompt_cache:bool = False

    def add_cachepoints(
            self,
            system=None,
            bedrock_messages=None,
            params = None
        
        ):
        if not self.support_prompt_cache:
            return system,bedrock_messages,params
        system = copy.deepcopy(system)
        bedrock_messages = copy.deepcopy(bedrock_messages)
        params = copy.deepcopy(params)
        if system:
            system.append({
                "cachePoint": {
                    "type": "default"
                }}
            )
        if bedrock_messages and isinstance(bedrock_messages[-1]['content'],list):
            
            bedrock_messages[-1]['content'].append(
            {
                "cachePoint": {
                    "type": "default"
                }}
            )
        if "toolConfig" in params and "nova" not in self.model_id and params['toolConfig']['tools']:
            params['toolConfig']['tools'].append({
            "cachePoint": {
                "type": "default"
            }
        })
        return system,bedrock_messages,params
        


    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Top Level call"""
        bedrock_messages, system = _messages_to_bedrock(messages)
        logger.debug(f"input message to bedrock: {bedrock_messages}")
        logger.debug(f"System message to bedrock: {system}")
        params = self._converse_params(
            stop=stop, **_snake_to_camel_keys(kwargs, excluded_keys={"inputSchema"})
        )

        system,bedrock_messages,params = self.add_cachepoints(
            system=system,
            bedrock_messages=bedrock_messages,
            params=params
        )

        logger.debug(f"Input params: {params}")
        logger.info("Using Bedrock Converse API to generate response")
        response = self.client.converse(
            messages=bedrock_messages, system=system, **params
        )
        logger.debug(f"Response from Bedrock: {response}")
        response_message = _parse_response(response)
        return ChatResult(generations=[ChatGeneration(message=response_message)])
        

    def _stream(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        bedrock_messages, system = _messages_to_bedrock(messages)
        params = self._converse_params(
            stop=stop, **_snake_to_camel_keys(kwargs, excluded_keys={"inputSchema"})
        )

        system,bedrock_messages,params = self.add_cachepoints(
            system=system,
            bedrock_messages=bedrock_messages,
            params=params
        )

        response = self.client.converse_stream(
            messages=bedrock_messages, system=system, **params
        )
        for event in response["stream"]:
            if message_chunk := _parse_stream_event(event):
                generation_chunk = ChatGenerationChunk(message=message_chunk)
                if run_manager:
                    run_manager.on_llm_new_token(
                        generation_chunk.text, chunk=generation_chunk
                    )
                yield generation_chunk

class BedrockBaseModel(ChatModelBase):
    default_model_kwargs = {"max_tokens": 2000,
                            "temperature": 0.7, "top_p": 0.9}
    # enable_any_tool_choice = False
    # any_tool_choice_value: str = 'any'
    model_provider = ModelProvider.BEDROCK
    is_reasoning_model: bool = False
    support_prompt_cache: bool = False

    @classmethod
    def create_model(cls, model_kwargs=None, **kwargs):
        model_kwargs = model_kwargs or {}
        model_kwargs = {**cls.default_model_kwargs, **model_kwargs}


        credentials_profile_name = (
            kwargs.get("credentials_profile_name", None)
            or os.environ.get("AWS_PROFILE", None)
            or None
        )
        region_name = (
            kwargs.get("region_name", None)
            or os.environ.get("BEDROCK_REGION", None)
            or None
        )
        br_aws_access_key_id = os.environ.get("BEDROCK_AWS_ACCESS_KEY_ID", "")
        br_aws_secret_access_key = os.environ.get(
            "BEDROCK_AWS_SECRET_ACCESS_KEY", "")

        model_name = cls.model or cls.model_id
        guardrail_config = kwargs.get('guardrail_config',None)

        init_kwargs = dict(
            model=model_name,
            enable_any_tool_choice=cls.enable_any_tool_choice,
            enable_prefill=cls.enable_prefill,
            is_reasoning_model=cls.is_reasoning_model,
            support_prompt_cache=cls.support_prompt_cache,
            guardrail_config=guardrail_config,
            **model_kwargs
        )

        if br_aws_access_key_id != "" and br_aws_secret_access_key != "":
            logger.info(
                f"Bedrock Using AWS AKSK from environment variables. Key ID: {br_aws_access_key_id}")

            client = get_boto3_client(
                "bedrock-runtime", 
                region_name=region_name,
                aws_access_key_id=br_aws_access_key_id, 
                aws_secret_access_key=br_aws_secret_access_key
            )

            llm = ChatBedrockConverse(
                client=client,
                **init_kwargs
            )
        else:
            client = get_boto3_client(
                "bedrock-runtime", 
                profile_name=credentials_profile_name,
                region_name=region_name,
            )
            llm = ChatBedrockConverse(
                client=client,
                **init_kwargs
            )
        llm.client.converse_stream = llm_messages_print_decorator(
            llm.client.converse_stream)
        llm.client.converse = llm_messages_print_decorator(llm.client.converse)
        return llm


BedrockBaseModel.create_for_models(BEDROCK_MODEL_CONFIGS)
