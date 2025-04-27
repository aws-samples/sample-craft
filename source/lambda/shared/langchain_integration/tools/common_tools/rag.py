from shared.utils.lambda_invoke_utils import StateContext
from shared.utils.prompt_utils import get_prompt_templates_from_ddb
from shared.constant import (
    LLMTaskType,
    Threshold
)
import asyncio
from shared.utils.lambda_invoke_utils import send_trace
from shared.langchain_integration.retrievers import OpensearchHybridQueryDocumentRetriever
from shared.langchain_integration.chains import LLMChain
from langchain_core.documents import Document
from shared.utils.monitor_utils import format_rag_data
from typing import Iterable,List
from shared.utils.logger_utils import get_logger
from langchain.retrievers.merger_retriever import MergerRetriever
from shared.langchain_integration.models.chat_models import (
    ReasonModelResult,ReasonModelStreamResult
)
# from shared.utils.asyncio_utils import run_coroutine_with_new_el

logger = get_logger("rag_tool")

def filter_response(res: Iterable, state: dict):
    """
    Filter out reference tags from the response and store reference numbers
    Args:
        res: Generator object from LLM response
        state: State dictionary to store references
    Returns:
        Generator yielding filtered response
    """
    buffer = ""
    references = []
    tag_start = "<reference>"
    tag_end = "</reference>"
    
    for char in res:
        char_strip = char.strip()
        if not buffer and char_strip not in ["<", "<reference"]:
            yield char
            continue

        buffer += char

        # Check the string starts with <reference>
        if buffer.strip() == tag_start[:len(buffer.strip())]:
            continue
        elif buffer.startswith(tag_start):
            buffer = buffer.strip()
            if buffer.endswith(tag_end):
                # Get reference document number after finding </reference>
                ref_content = buffer[len(tag_start):-len(tag_end)]
                try:
                    ref_num = int(ref_content)
                    references.append(ref_num)
                except ValueError:
                    logger.warning(f"Invalid reference number: {ref_content}")
                buffer = ""
            continue
        else:
            # Move next
            yield buffer[0]
            buffer = buffer[1:]

    if buffer:
        yield buffer

    if references:
        state["extra_response"]["references"] = references
        all_docs:List[Document] = state["extra_response"]["docs"]
        ref_docs = []
        ref_figures = []

        for ref in references:
            try:
                doc_id = ref
                ref_docs.append(all_docs[doc_id-1])
                ref_figures.extend(all_docs[doc_id-1].metadata.get("figure", []))
            except Exception as e:
                logger.error(f"Invalid reference doc id: {ref}. Error: {e}")

        # Remove duplicate figures
        unique_set = {tuple(d.items()) for d in ref_figures}
        unique_figure_list = [dict(t) for t in unique_set]
        state["extra_response"]["ref_docs"] = ref_docs
        state["extra_response"]["ref_figures"] = unique_figure_list



# def format_retrieved_context(retrieved_context:Document,chunk_id_field)->List[str]:
#     """
#     Format the retrieved contexts into a list of dictionaries
#     Args:
#         retrieved_contexts: List of retrieved contexts
#     Returns:
#         List of dictionaries containing the formatted contexts
#     """
#     extend_chunks:List[Document] = retrieved_context.metadata.get("extend_chunks", [])
#     page_content = retrieved_context.page_content

#     extend_page_content = "\n".join([chunk.page_content for chunk in extend_chunks])
#     if page_content in extend_page_content:
#         return extend_page_content
#     else:
#         return extend_page_content + "\n" + page_content



def format_retrieved_contexts(
        retrieved_contexts:List[Document],
        chunk_id_field:str
    )->List[str]:
    all_chunks = []
    chunk_ids_set = set()
    for doc in retrieved_contexts:
        extend_chunks:List[Document] = doc.metadata.get("extend_chunks", [])
        extend_chunks = extend_chunks + [doc]
        for chunk in extend_chunks:
            if chunk.metadata[chunk_id_field] not in chunk_ids_set:
                all_chunks.append(chunk)
                chunk_ids_set.add(chunk.metadata[chunk_id_field])
    
    all_chunks = sorted(all_chunks, key=lambda x: x.metadata[chunk_id_field])
    return all_chunks, [chunk.page_content for chunk in all_chunks]


def rag_tool(retriever_config: dict, query=None):
    state = StateContext.get_current_state()
    context_list = []
    # Add QQ match results
    context_list.extend(state['qq_match_results'])
    # figure_list = []
    retriever_params = retriever_config
    retriever_params["query"] = query or state[retriever_config.get(
        "query_key", "query")]
    
    # 
    qd_retrievers = [
                OpensearchHybridQueryDocumentRetriever.from_config(
                **retriver_config
            ) for retriver_config in retriever_config['retrievers']
        ]
    
    qd_retriever = MergerRetriever(
        retrievers=qd_retrievers
    )
    
    # qd_retriever = OpensearchHybridQueryDocumentRetriever.from_config(
    #     **retriever_params
    # )
    try:
        # Set a reasonable timeout for the retrieval operation
        retrieved_contexts:List[Document] = asyncio.run(qd_retriever.ainvoke(retriever_params["query"]))

    except TimeoutError as e:
        logger.warning(f"RAG retrieval timed out: {e}")
        # Return empty results to continue processing
        retrieved_contexts = []
    except Exception as e:
        logger.error(f"Error during RAG retrieval: {e}")
        # Return empty results to continue processing
        retrieved_contexts = []

    # output = retrieve_fn(retriever_params)
    # top_k = retriever_config.get("top_k", Threshold.TOP_K_RETRIEVALS)
    # score = retriever_config.get("score", Threshold.ALL_KNOWLEDGE_IN_AGENT_THRESHOLD)
    # filtered_docs = [item for item in output["result"]["docs"] if item["score"] >= score]
    # sorted_docs = sorted(filtered_docs, key=lambda x: x["score"], reverse=True)
    # final_docs = sorted_docs[:top_k]
    #

    # retrieved_contexts
    # final_docs = []

    # state["extra_response"]["docs"] = final_docs
    chunk_id_field = qd_retrievers[0].database.chunk_id_field

    # for doc in retrieved_contexts:
    #     # formated_context = format_retrieved_context(
    #     #     doc,
    #     #     chunk_id_field=chunk_id_field
    #     # )
    #     # # final_docs.append(formated_context)
    #     # context_list.append(formated_context)
    #     # context_list.append(doc["page_content"])
    #     figure_list = figure_list + doc.metadata.get("figure", [])
    
    # retriver result format 
    retrieved_contexts,context_list = format_retrieved_contexts(
        retrieved_contexts,
        chunk_id_field=chunk_id_field 
    )

    state["extra_response"]["docs"] = retrieved_contexts

    context_md = format_rag_data(
        retrieved_contexts, 
        state.get("qq_match_results", []),
        source_field=qd_retrievers[0].database.source_field
    )
    send_trace(
        f"\n\n{context_md}\n\n", enable_trace=state["enable_trace"])
    # send_trace(
    #     f"\n\n**rag-contexts:**\n\n {context_list}", enable_trace=state["enable_trace"])

    group_name = state["chatbot_config"]["group_name"]
    llm_config = state["chatbot_config"]["private_knowledge_config"]["llm_config"]
    chatbot_id = state["chatbot_config"]["chatbot_id"]
    task_type = LLMTaskType.RAG
    prompt_templates_from_ddb = get_prompt_templates_from_ddb(
        group_name,
        model_id=llm_config["model_id"],
        task_type=task_type,
        chatbot_id=chatbot_id
    )

    llm_config = {
        **prompt_templates_from_ddb,
        **llm_config,
        "stream": state["stream"],
        "intent_type": task_type,
    }

    llm_input = {
        "contexts": context_list,
        "query": state["query"],
        "chat_history": state["chat_history"]
    }

    chain = LLMChain.get_chain(
        **llm_config
    )
    output = chain.invoke(llm_input)

    if not state["stream"]:
        output = str(output)
        filtered_output = filter_response(output, state)
        return filtered_output, filtered_output
    else:
        if isinstance(output,(ReasonModelStreamResult,)):
            output.content_stream = filter_response(
                output.content_stream,
                state
            )
            output.new_stream = filter_response(
                output.generate_stream(output.message_stream),
                state
            )
        else:
            output = filter_response(output, state)
        
        return output, output
