import json
import pathlib
import os
import asyncio
from typing import List
from langchain_core.documents import Document
from shared.utils.logger_utils import get_logger
from shared.utils.lambda_invoke_utils import chatbot_lambda_call_wrapper
from shared.langchain_integration.retrievers import OpensearchHybridQueryQuestionRetriever
from langchain.retrievers.merger_retriever import MergerRetriever
from shared.utils.asyncio_utils import run_coroutine_with_new_el
logger = get_logger("intention")
kb_enabled = os.environ["KNOWLEDGE_BASE_ENABLED"].lower() == "true"
kb_type = json.loads(os.environ["KNOWLEDGE_BASE_TYPE"])
intelli_agent_kb_enabled = kb_type.get(
    "intelliAgentKb", {}).get("enabled", False)


def get_intention_results(query: str, intention_config: dict, intent_threshold: float):
    """get intention few shots results according embedding similarity

    Args:
        query (str): input query from human
        intention_config (dict): intention config information

    Returns:
        intent_fewshot_examples (dict): retrieved few shot examples
    """
    event_body = {
        "query": query,
        "type": "qq",
        **intention_config
    }


    intention_retriever = MergerRetriever(retrievers=[
        OpensearchHybridQueryQuestionRetriever.from_config(
        **{
            **retriver_config,
            "rerank_config":None,
            "enable_bm25_search":False
        }  
    ) for retriver_config in intention_config['retrievers']
    ])
    intention_retrievered:List[Document] = run_coroutine_with_new_el(intention_retriever.ainvoke(event_body['query']))
    # res = retrieve_fn(event_body)

    if not intention_retrievered:
        # Return to guide the user to add intentions
        return [], False
    else:
        intent_fewshot_examples = []
        for doc in intention_retrievered:
            if doc.metadata["score"] > intent_threshold:
                doc_item = {
                    "query": doc.page_content,
                    "score": doc.metadata["score"],
                    "name": doc.metadata["answer"],
                    "intent": doc.metadata["answer"],
                    "kwargs": doc.metadata.get("kwargs", {}),
                }
                intent_fewshot_examples.append(doc_item)

    return intent_fewshot_examples, True


@chatbot_lambda_call_wrapper
def lambda_handler(state: dict, context=None):
    intention_config = state["chatbot_config"].get("intention_config", {})
    query_key = intention_config.get(
        "retriever_config", {}).get("query_key", "query")
    query = state[query_key]

    output: list = get_intention_results(
        query,
        {
            **intention_config,
        }
    )
    return output
