# lambda/init_data.py
import json
import logging
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

model_table_name = os.environ["MODEL_TABLE_NAME"]
chat_bot_table_name = os.environ["CHATBOT_TABLE_NAME"]
index_table_name = os.environ["INDEX_TABLE_NAME"]
time_str = str(datetime.now(timezone.utc))

dynamodb = boto3.resource("dynamodb")

chat_bot_table = dynamodb.Table(chat_bot_table_name)
model_table = dynamodb.Table(model_table_name)
index_table = dynamodb.Table(index_table_name)

EMBEDDING_MODEL_TYPE = "embedding"
RERANK_MODEL_TYPE = "rerank"
VLM_MODEL_TYPE = "vlm"

BCE_EMBEDDING_MODEL_ID = "bce-embedding-base_v1"
BGE_RERANKER_MODEL_ID = "bge-reranker-large"


def extract_model_config(model_info):
    """Extract model configuration from model_info"""
    config = {}

    # Extract embedding model configuration
    embeddings_models = model_info.get("embeddingsModels", [])
    embeddings_model = (
        embeddings_models[0]
        if embeddings_models and len(embeddings_models) > 0
        else {}
    )
    embedding_model_id = embeddings_model.get("id")

    config["embedding"] = {
        "modelId": embedding_model_id,
        "targetModel": __gen_target_model(embedding_model_id),
        "modelDimension": embeddings_model.get("dimensions"),
        "modelEndpoint": embeddings_model.get("modelEndpoint"),
        "modelProvider": embeddings_model.get("provider"),
    }

    # Extract rerank model configuration
    rerank_models = model_info.get("rerankModels", [])
    rerank_model = (
        rerank_models[0] if rerank_models and len(rerank_models) > 0 else {}
    )
    rerank_model_id = rerank_model.get("id")

    config["rerank"] = {
        "modelId": rerank_model.get("id"),
        "targetModel": __gen_target_model(rerank_model_id),
        "modelEndpoint": rerank_model.get("modelEndpoint"),
        "modelProvider": rerank_model.get("provider"),
    }

    # Extract VLM model configuration
    vlm_models = model_info.get("vlms", [])
    vlm_model = vlm_models[0] if vlm_models and len(vlm_models) > 0 else {}
    vlm_model_id = vlm_model.get("id")

    config["vlm"] = {
        "modelId": vlm_model_id,
        "modelEndpoint": vlm_model.get("modelEndpoint", ""),
        "modelProvider": vlm_model.get("provider", ""),
    }

    return config


def create_model(model_id, model_type, model_params):
    """Create a model entry in DynamoDB"""
    model_table.put_item(
        Item={
            "groupName": "Admin",
            "modelId": model_id,
            "createTime": time_str,
            "modelType": model_type,
            "parameter": {"apiKeyArn": "", "baseUrl": "", **model_params},
            "status": "ACTIVE",
            "updateTime": time_str,
        }
    )


def create_chatbot(chatbot_id):
    """Create a chatbot entry in DynamoDB"""
    chat_bot_table.put_item(
        Item={
            "groupName": "Admin",
            "chatbotId": chatbot_id,
            "chatbotDescription": "Answer question based on search result",
            "createTime": time_str,
            "indexIds": {
                "intention": {
                    "count": 1,
                    "value": {
                        "admin-intention-default": "admin-intention-default"
                    },
                },
                "qd": {
                    "count": 1,
                    "value": {"admin-qd-default": "admin-qd-default"},
                },
                "qq": {
                    "count": 1,
                    "value": {"admin-qq-default": "admin-qq-default"},
                },
            },
            "embeddingModelId": "admin-embedding",
            "rerankModelId": "admin-rerank",
            "vlmModelId": "admin-vlm",
            "status": "ACTIVE",
            "updateTime": time_str,
        }
    )


def create_index(index_id, index_type):
    """Create an index entry in DynamoDB"""
    index_table.put_item(
        Item={
            "groupName": "Admin",
            "indexId": index_id,
            "createTime": time_str,
            "description": "Answer question based on search result",
            "indexType": index_type,
            "kbType": "aos",
            "modelIds": {
                "embedding": "admin-embedding",
                "rerank": "admin-rerank",
            },
            "status": "ACTIVE",
            "tag": index_id,
        }
    )


def __gen_target_model(model_id: str):
    if model_id == BCE_EMBEDDING_MODEL_ID:
        return "bce_embedding_model.tar.gz"
    elif model_id == BGE_RERANKER_MODEL_ID:
        return "bge_reranker_model.tar.gz"
    else:
        return ""


def check_admin_chatbot():
    try:
        response = chat_bot_table.get_item(
            Key={"groupName": "Admin", "chatbotId": "admin"}
        )
        return "Item" in response
    except ClientError as e:
        logger.error(f"Operation failed: {e.response['Error']['Message']}")
        raise


def init_chatbot(model_config):

    # Initialize models
    create_model(
        model_id="admin-embedding",
        model_type=EMBEDDING_MODEL_TYPE,
        model_params=model_config["embedding"],
    )
    create_model(
        model_id="admin-rerank",
        model_type=RERANK_MODEL_TYPE,
        model_params=model_config["rerank"],
    )
    create_model(
        model_id="admin-vlm",
        model_type=VLM_MODEL_TYPE,
        model_params=model_config["vlm"],
    )

    # Initialize chatbot
    create_chatbot("admin")

    # Initialize indexes
    index_types = ["intention", "qd", "qq"]
    for index_type in index_types:
        create_index(
            index_id=f"admin-{index_type}-default",
            index_type=index_type,
        )


def update_model_table_item(item, model_config):
    model_type = item.get("modelType")
    parameters = item.get("parameter", {})
    model_id = parameters.get("modelId")

    # Update embedding model endpoint
    if (
        model_type == EMBEDDING_MODEL_TYPE
        and model_id == BCE_EMBEDDING_MODEL_ID
    ):
        model_table.update_item(
            Key={"groupName": item["groupName"], "modelId": item["modelId"]},
            UpdateExpression="SET #param.modelEndpoint = :endpoint, updateTime = :time",
            ExpressionAttributeNames={
                "#param": "parameter"
            },
            ExpressionAttributeValues={
                ":endpoint": model_config["embedding"]["modelEndpoint"],
                ":time": time_str,
            },
        )
        logger.info(f"Updated embedding model endpoint for {item['modelId']}")

    # Update rerank model endpoint
    elif model_type == RERANK_MODEL_TYPE and model_id == BGE_RERANKER_MODEL_ID:
        model_table.update_item(
            Key={"groupName": item["groupName"], "modelId": item["modelId"]},
            UpdateExpression="SET #param.modelEndpoint = :endpoint, updateTime = :time",
            ExpressionAttributeNames={
                "#param": "parameter"
            },
            ExpressionAttributeValues={
                ":endpoint": model_config["rerank"]["modelEndpoint"],
                ":time": time_str,
            },
        )
        logger.info(f"Updated rerank model endpoint for {item['modelId']}")


def update_sagemaker_endpoint(model_config):
    """
    Scan all models in the model table and update specific endpoints based on model type and ID.

    Args:
        model_config (dict): Configuration containing endpoint information for different model types
    """
    try:
        # Scan and process all items, automatically handling pagination
        scan_kwargs = {}
        scan_done = False

        while not scan_done:
            response = model_table.scan(**scan_kwargs)

            # Process items in the current batch
            for item in response.get("Items", []):
                update_model_table_item(item, model_config)

            # Check if more items need to be processed
            if "LastEvaluatedKey" in response:
                scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
            else:
                scan_done = True

    except ClientError as e:
        logger.error(
            f"Failed to update SageMaker endpoints: {e.response['Error']['Message']}"
        )
        raise


def handler(event, context):
    logger.info(f"Received event: {event}")

    model_info = json.loads(event["ResourceProperties"]["modelInfo"])

    # Check if admin chatbot already exists
    try:
        admin_chatbot_exists = check_admin_chatbot()
        model_config = extract_model_config(model_info)
        if not admin_chatbot_exists:
            init_chatbot(model_config)
        else:
            logger.info(
                "Admin chatbot already exists. Skipping initialization."
            )

        # Update SageMaker endpoints for existing models
        update_sagemaker_endpoint(model_config)

        return {"status": "SUCCESS"}
    except ClientError as e:
        logger.error(f"Operation failed: {e.response['Error']['Message']}")
        raise
