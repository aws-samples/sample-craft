import itertools
import json
import logging
import os
import sys
import traceback
from datetime import datetime, timezone
from typing import Generator, Iterable, List

import boto3
from langchain.docstore.document import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import OpenSearchVectorSearch
from langchain_community.vectorstores.opensearch_vector_search import (
    OpenSearchVectorSearch,
)
from opensearchpy import RequestsHttpConnection
from requests_aws4auth import AWS4Auth
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Default environment variables
from schemas.processing_parameters import ProcessingParameters, VLLMParameters
from utils.constant import SplittingType
from loaders.loader import process_object
from utils.storage_utils import save_content_to_s3
from utils import sm_utils


aos_endpoint = os.getenv("AOS_ENDPOINT", "")
batch_file_number = os.getenv("BATCH_FILE_NUMBER", "10")
batch_indice = os.getenv("BATCH_INDICE", "0")
document_language = os.getenv("DOCUMENT_LANGUAGE", "zh")
etl_endpoint_name = os.getenv("ETL_MODEL_ENDPOINT", "")
etl_object_table_name = os.getenv("ETL_OBJECT_TABLE", "")
portal_bucket_name = os.getenv("PORTAL_BUCKET", "")
table_item_id = os.getenv("TABLE_ITEM_ID", "")
qa_enhancement = os.getenv("QA_ENHANCEMENT", "false")
region = os.getenv("AWS_REGION", "us-east-1")
bedrock_region = os.getenv("BEDROCK_REGION", region)
res_bucket = os.getenv("RES_BUCKET", "")
s3_bucket = os.getenv("S3_BUCKET", "")
s3_prefix = os.getenv("S3_PREFIX", "")
chatbot_id = os.getenv("CHATBOT_ID", "default")
group_name = os.getenv("GROUP_NAME", "default")
aos_index_name = os.getenv("INDEX_ID", "default")
chatbot_table = os.getenv("CHATBOT_TABLE", "")
model_table_name = os.getenv("MODEL_TABLE", "")
index_type = os.getenv("INDEX_TYPE", "qd")
# Valid Operation types: "create", "delete", "update", "extract_only"
operation_type = os.getenv("OPERATION_TYPE", "create")
aos_secret = os.getenv("AOS_SECRET_ARN", "-")

# Constants
ENHANCE_CHUNK_SIZE = 25000
OBJECT_EXPIRY_TIME = 3600
MAX_OS_DOCS_PER_PUT = 8


def initialize_aws_clients(etl_object_table_name, model_table_name):
    """Initialize AWS clients"""
    try:
        region = os.getenv("AWS_REGION", "us-east-1")
        s3_client = boto3.client("s3", region_name=region)
        dynamodb = boto3.resource("dynamodb", region_name=region)
        
        etl_object_table = dynamodb.Table(etl_object_table_name) if etl_object_table_name else None
        model_table = dynamodb.Table(model_table_name) if model_table_name else None
        
        return s3_client, dynamodb, etl_object_table, model_table
    except Exception as e:
        logger.warning(f"Could not initialize AWS clients: {e}")
        return None, None, None, None

def get_model_info_local(model_table, group_name, chatbot_id):
    """Get model information from DynamoDB or return defaults"""
    try:
        if not model_table:
            return {}, {}
            
        # Get Embedding Model Parameters
        embedding_model_item = model_table.get_item(
            Key={"groupName": group_name, "modelId": f"{chatbot_id}-embedding"}
        ).get("Item")
        embedding_model_info = embedding_model_item.get("parameter", {}) if embedding_model_item else {}

        # Get VLM Model Parameters
        vlm_model_item = model_table.get_item(
            Key={"groupName": group_name, "modelId": f"{chatbot_id}-vlm"}
        ).get("Item")
        vlm_model_info = vlm_model_item.get("parameter", {}) if vlm_model_item else {}
        
        return embedding_model_info, vlm_model_info
    except Exception as e:
        logger.warning(f"Could not get model info: {e}")
        return {}, {}

def get_aws_auth(region, aos_secret="-"):
    """Get AWS authentication for OpenSearch"""
    try:
        credentials = boto3.Session().get_credentials()
    except:
        credentials = None
        
    if not credentials:
        logger.warning("No AWS credentials available")
        return None
        
    if aos_secret != "-":
        try:
            secrets_manager_client = boto3.client("secretsmanager", region_name=region)
            master_user = secrets_manager_client.get_secret_value(
                SecretId=aos_secret
            )["SecretString"]
            cred = json.loads(master_user)
            username = cred.get("username")
            password = cred.get("password")
            aws_auth = (username, password)
        except Exception as e:
            logger.info(f"Error retrieving secret, using IAM authentication: {e}")
            aws_auth = AWS4Auth(
                refreshable_credentials=credentials, region=region, service="es"
            )
    else:
        logger.info("No secret provided, using IAM authentication")
        aws_auth = AWS4Auth(
            refreshable_credentials=credentials, region=region, service="es"
        )
    return aws_auth


def update_etl_object_table(
    processing_params: ProcessingParameters, status: str, detail: str = "", etl_table=None, execution_id=""
):
    """
    Update the etl object table with the processing parameters.

    Args:
        processing_params (ProcessingParameters): The processing parameters.
        etl_table: The ETL object table instance.
        execution_id: The execution ID for the job.
    """
    try:
        if not etl_table:
            logger.info(f"ETL object table not available, status: {status}")
            return
            
        input_body = {
            "s3Path": f"s3://{processing_params.source_bucket_name}/{processing_params.source_object_key}",
            "s3Bucket": processing_params.source_bucket_name,
            "s3Prefix": processing_params.source_object_key,
            "executionId": execution_id,
            "createTime": str(datetime.now(timezone.utc)),
            "status": status,
            "detail": detail,
        }
        etl_table.put_item(Item=input_body)
    except Exception as e:
        logger.warning(f"Could not update ETL object table: {e}")


class S3FileIterator:
    def __init__(
        self, bucket: str, prefix: str, supported_file_types: List[str] = [], s3_client=None, batch_file_number="10", batch_indice="0", document_language="zh", etl_endpoint_name="", res_bucket="", portal_bucket_name="", vlm_model_info=None, etl_table=None, execution_id=""
    ):
        self.bucket = bucket
        self.prefix = prefix
        self.supported_file_types = supported_file_types
        self.batch_file_number = batch_file_number
        self.batch_indice = batch_indice
        self.document_language = document_language
        self.etl_endpoint_name = etl_endpoint_name
        self.res_bucket = res_bucket
        self.portal_bucket_name = portal_bucket_name
        self.vlm_model_info = vlm_model_info or {}
        self.etl_table = etl_table
        self.execution_id = execution_id
        if s3_client:
            self.paginator = s3_client.get_paginator("list_objects_v2")
        else:
            self.paginator = None

    def iterate_s3_files(self, extract_content=True) -> Generator:
        if not self.paginator:
            logger.warning("S3 client not available, using mock data")
            # Return mock data for local development
            yield ProcessingParameters(
                source_bucket_name=self.bucket,
                source_object_key="mock/test.pdf",
                etl_endpoint_name=self.etl_endpoint_name,
                result_bucket_name=self.res_bucket,
                portal_bucket_name=self.portal_bucket_name,
                document_language=self.document_language,
                file_type="pdf",
                vllm_parameters=VLLMParameters()
            )
            return
            
        current_indice = 0
        for page in self.paginator.paginate(
            Bucket=self.bucket, Prefix=self.prefix
        ):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                file_type = key.split(".")[-1].lower()  # Extract file extension

                if (
                    key.endswith("/")
                    or file_type not in self.supported_file_types
                ):
                    continue

                if current_indice < int(self.batch_indice) * int(self.batch_file_number):
                    current_indice += 1
                    continue
                elif current_indice >= (int(self.batch_indice) + 1) * int(
                    self.batch_file_number
                ):
                    # Exit this nested loop
                    break
                else:
                    logger.info("Processing object: %s", key)
                    current_indice += 1

                    # Create VLLM parameters
                    vllm_params = VLLMParameters(
                        model_provider=self.vlm_model_info.get("modelProvider"),
                        model_id=self.vlm_model_info.get("modelId"),
                        model_api_url=self.vlm_model_info.get("baseUrl"),
                        model_secret_name=self.vlm_model_info.get("apiKeyArn"),
                        model_sagemaker_endpoint_name=self.vlm_model_info.get(
                            "modelEndpoint"
                        ),
                    )

                    # Create processing parameters with VLLM parameters
                    processing_params = ProcessingParameters(
                        source_bucket_name=self.bucket,
                        source_object_key=key,
                        etl_endpoint_name=self.etl_endpoint_name,
                        result_bucket_name=self.res_bucket,
                        portal_bucket_name=self.portal_bucket_name,
                        document_language=self.document_language,
                        file_type=file_type,
                        vllm_parameters=vllm_params,
                    )

                    update_etl_object_table(processing_params, "RUNNING", "", self.etl_table, self.execution_id)

                    yield processing_params

            if current_indice >= (int(self.batch_indice) + 1) * int(
                self.batch_file_number
            ):
                # Exit the outer loop
                break


class BatchChunkDocumentProcessor:
    """
    A class that processes documents in batches and chunks.

    Args:
        chunk_size (int): The size of each chunk.
        chunk_overlap (int): The overlap between consecutive chunks.
        batch_size (int): The size of each batch.

    Methods:
        chunk_generator(content: List[Document]) -> Generator[Document, None, None]:
            Generates chunks of documents from the given content.

        batch_generator(content: List[Document], gen_chunk_flag: bool = True):
            Generates batches of documents from the given content.

    """

    def __init__(
        self,
        chunk_size: int,
        chunk_overlap: int,
        batch_size: int,
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.batch_size = batch_size

    def chunk_generator(
        self, content: List[Document]
    ) -> Generator[Document, None, None]:
        """
        Generates chunks of documents from the given content.

        Args:
            content (List[Document]): The list of documents to be chunked.

        Yields:
            Document: A chunk of a document.

        """
        temp_text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap
        )
        temp_content = content
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap
        )
        updated_heading_hierarchy = {}
        for temp_document in temp_content:
            temp_chunk_id = temp_document.metadata["chunk_id"]
            temp_split_size = len(
                temp_text_splitter.split_documents([temp_document])
            )
            # Add size in heading_hierarchy
            if "heading_hierarchy" in temp_document.metadata:
                temp_hierarchy = temp_document.metadata["heading_hierarchy"]
                temp_hierarchy["size"] = temp_split_size
                updated_heading_hierarchy[temp_chunk_id] = temp_hierarchy

        for document in content:
            splits = text_splitter.split_documents([document])
            # List of Document objects
            index = 1
            for split in splits:
                chunk_id = split.metadata["chunk_id"]
                logger.info(chunk_id)
                split.metadata["chunk_id"] = f"{chunk_id}-{index}"
                if chunk_id in updated_heading_hierarchy:
                    split.metadata["heading_hierarchy"] = (
                        updated_heading_hierarchy[chunk_id]
                    )
                    logger.info(split.metadata["heading_hierarchy"])
                index += 1
                yield split

    def batch_generator(
        self, content: List[Document], gen_chunk_flag: bool = True
    ):
        """
        Generates batches of documents from the given content.

        Args:
            content (List[Document]): The list of documents to be batched.
            gen_chunk_flag (bool, optional): Flag indicating whether to generate chunks before batching. Defaults to True.

        Yields:
            List[Document]: A batch of documents.

        """
        if gen_chunk_flag:
            generator = self.chunk_generator(content)
        else:
            generator = content
        iterator = iter(generator)
        while True:
            batch = list(itertools.islice(iterator, self.batch_size))
            if not batch:
                break
            yield batch


class BatchQueryDocumentProcessor:
    """
    A class that processes batch queries for documents.

    Args:
        docsearch (OpenSearchVectorSearch): An instance of OpenSearchVectorSearch used for document search.
        batch_size (int): The size of each batch.

    Methods:
        query_documents(s3_path): Queries documents based on the given S3 path.
        batch_generator(s3_path): Generates batches of document IDs based on the given S3 path.
    """

    def __init__(
        self,
        docsearch: OpenSearchVectorSearch,
        batch_size: int,
    ):
        self.docsearch = docsearch
        self.batch_size = batch_size

    def query_documents(self, s3_path) -> Iterable:
        """
        Queries documents based on the given S3 path.

        Args:
            s3_path (str): The S3 path to query documents from.

        Returns:
            Iterable: An iterable of document IDs.
        """
        if not self.docsearch:
            logger.warning("DocSearch not available")
            return []
            
        search_body = {
            "query": {
                # use term-level queries only for fields mapped as keyword
                "prefix": {"metadata.file_path.keyword": {"value": s3_path}},
            },
            "size": 10000,
            "sort": [{"_score": {"order": "desc"}}],
            "_source": {"excludes": ["vector_field"]},
        }

        if self.docsearch.client.indices.exists(
            index=self.docsearch.index_name
        ):
            logger.info(
                "BatchQueryDocumentProcessor: Querying documents for %s",
                s3_path,
            )
            query_documents = self.docsearch.client.search(
                index=self.docsearch.index_name, body=search_body
            )
            document_ids = [
                doc["_id"] for doc in query_documents["hits"]["hits"]
            ]
            return document_ids
        else:
            logger.info(
                "BatchQueryDocumentProcessor: Index %s does not exist, skipping deletion",
                self.docsearch.index_name,
            )
            return []

    def batch_generator(self, s3_path):
        """
        Generates batches of document IDs based on the given S3 path.

        Args:
            s3_path (str): The S3 path to generate batches from.

        Yields:
            list: A batch of document IDs.
        """
        generator = self.query_documents(s3_path)
        iterator = iter(generator)
        while True:
            batch = list(itertools.islice(iterator, self.batch_size))
            if not batch:
                break
            yield batch


class OpenSearchIngestionWorker:
    def __init__(
        self,
        docsearch: OpenSearchVectorSearch,
        embedding_model_id: str,
    ):
        self.docsearch = docsearch
        self.embedding_model_id = embedding_model_id

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
    )
    def aos_ingestion(self, documents: List[Document]) -> None:
        if not self.docsearch:
            logger.info("OpenSearch not available, skipping ingestion")
            return
            
        texts = [doc.page_content for doc in documents]
        metadatas = [doc.metadata for doc in documents]
        embeddings_vectors = self.docsearch.embedding_function.embed_documents(
            list(texts)
        )

        if isinstance(embeddings_vectors[0], dict):
            embeddings_vectors_list = []
            metadata_list = []
            for doc_id, metadata in enumerate(metadatas):
                embeddings_vectors_list.append(
                    embeddings_vectors[0]["dense_vecs"][doc_id]
                )
                metadata["embedding_model_id"] = self.embedding_model_id
                metadata_list.append(metadata)
            embeddings_vectors = embeddings_vectors_list
            metadatas = metadata_list
        self.docsearch._OpenSearchVectorSearch__add(
            texts, embeddings_vectors, metadatas=metadatas
        )


class OpenSearchDeleteWorker:
    def __init__(self, docsearch: OpenSearchVectorSearch):
        self.docsearch = docsearch
        self.index_name = self.docsearch.index_name if docsearch else None

    def aos_deletion(self, document_ids) -> None:
        if not self.docsearch:
            logger.info("OpenSearch not available, skipping deletion")
            return
            
        bulk_delete_requests = []

        # Check if self.index_name exists
        if not self.docsearch.client.indices.exists(index=self.index_name):
            logger.info("Index %s does not exist", self.index_name)
            return
        else:
            for document_id in document_ids:
                bulk_delete_requests.append(
                    {"delete": {"_id": document_id, "_index": self.index_name}}
                )

            self.docsearch.client.bulk(
                index=self.index_name, body=bulk_delete_requests, refresh=True
            )
            logger.info("Deleted %d documents", len(document_ids))
            return


def ingestion_pipeline(
    s3_files_iterator,
    batch_chunk_processor,
    ingestion_worker,
    extract_only=False,
    s3_client_param=None,
    etl_table=None,
    execution_id=""
):
    for processing_params in s3_files_iterator:
        try:
            # The res is list[Document] type
            documents = process_object(processing_params)
            for document in documents:
                save_content_to_s3(
                    s3_client_param or s3_client,
                    document,
                    processing_params.result_bucket_name,
                    SplittingType.SEMANTIC.value,
                )

            gen_chunk_flag = (
                False
                if processing_params.file_type in ["csv", "xlsx", "xls"]
                else True
            )
            batches = batch_chunk_processor.batch_generator(
                documents, gen_chunk_flag
            )

            ordered_chunk_id = 0

            for batch in batches:
                if len(batch) == 0:
                    continue

                for document in batch:
                    document.metadata["ordered_chunk_id"] = ordered_chunk_id
                    ordered_chunk_id += 1

                    if "complete_heading" in document.metadata:
                        document.page_content = (
                            document.metadata["complete_heading"]
                            + " "
                            + document.page_content
                        )
                    else:
                        document.page_content = document.page_content

                    save_content_to_s3(
                        s3_client_param or s3_client,
                        document,
                        processing_params.result_bucket_name,
                        SplittingType.CHUNK.value,
                    )

                if not extract_only:
                    ingestion_worker.aos_ingestion(batch)
            update_etl_object_table(processing_params, "COMPLETED", "", etl_table, execution_id)
        except Exception as e:
            logger.error(
                "Error processing object %s: %s",
                f"{processing_params.source_bucket_name}/{processing_params.source_object_key}",
                e,
            )
            update_etl_object_table(processing_params, "FAILED", str(e), etl_table, execution_id)
            traceback.print_exc()


def delete_pipeline(s3_files_iterator, document_generator, delete_worker):
    for processing_params in s3_files_iterator:
        try:
            s3_path = f"s3://{processing_params.source_bucket_name}/{processing_params.source_object_key}"

            batches = document_generator.batch_generator(s3_path)
            for batch in batches:
                if len(batch) == 0:
                    continue
                delete_worker.aos_deletion(batch)

        except Exception as e:
            logger.error(
                "Error processing object %s: %s",
                f"{processing_params.source_bucket_name}/{processing_params.source_object_key}",
                e,
            )
            traceback.print_exc()


def create_processors_and_workers(
    operation_type, docsearch, embedding_model_id, file_iterator
):
    """
    Create processors and workers based on the operation type.

    Args:
        operation_type (str): The type of operation to perform. Valid types are "create", "delete", "update", and "extract_only".
        docsearch: The instance of the DocSearch class.
        embedding_model_id: The id of the embedding model.
        file_iterator: The instance of the file processor.

    Returns:
        tuple: A tuple containing the following elements:
            - s3_files_iterator: The iterator for iterating over S3 files.
            - batch_processor: The batch processor for processing documents in chunks.
            - worker: The worker responsible for performing the operation.
    """

    if operation_type in ["create", "extract_only"]:
        s3_files_iterator = file_iterator.iterate_s3_files(extract_content=True)
        batch_processor = BatchChunkDocumentProcessor(
            chunk_size=1024, chunk_overlap=30, batch_size=10
        )
        worker = OpenSearchIngestionWorker(docsearch, embedding_model_id)
    elif operation_type in ["delete", "update"]:
        s3_files_iterator = file_iterator.iterate_s3_files(
            extract_content=False
        )
        batch_processor = BatchQueryDocumentProcessor(docsearch, batch_size=10)
        worker = OpenSearchDeleteWorker(docsearch)
    else:
        raise ValueError(
            "Invalid operation type. Valid types: create, delete, update, extract_only"
        )

    return s3_files_iterator, batch_processor, worker


def get_param_value(request_val, env_key, default_val):
    """Get parameter value with priority: request -> env -> default"""
    if request_val is not None:
        return request_val
    return os.getenv(env_key, default_val)

def main(request, job_id: str):
    # Resolve parameters with fallback: request -> env -> default
    s3_bucket = get_param_value(request.s3_bucket, 'S3_BUCKET', '')
    s3_prefix = get_param_value(request.s3_prefix, 'S3_PREFIX', '')
    operation_type = get_param_value(getattr(request, 'operation_type', None), 'OPERATION_TYPE', 'extract_only')
    batch_file_number = get_param_value(getattr(request, 'batch_file_number', None), 'BATCH_FILE_NUMBER', '10')
    batch_indice = get_param_value(getattr(request, 'batch_indice', None), 'BATCH_INDICE', '0')
    document_language = get_param_value(getattr(request, 'document_language', None), 'DOCUMENT_LANGUAGE', 'zh')
    index_type = get_param_value(getattr(request, 'index_type', None), 'INDEX_TYPE', 'qd')
    region = os.getenv("AWS_REGION", "us-east-1")
    
    aos_endpoint = get_param_value(getattr(request, 'aos_endpoint', None), "AOS_ENDPOINT", "")
    etl_endpoint_name = get_param_value(getattr(request, 'etl_endpoint_name', None), "ETL_MODEL_ENDPOINT", "")
    etl_object_table_name = get_param_value(getattr(request, 'etl_object_table_name', None), "ETL_OBJECT_TABLE", "")
    portal_bucket_name = get_param_value(getattr(request, 'portal_bucket_name', None), "PORTAL_BUCKET", "")
    bedrock_region = get_param_value(getattr(request, 'bedrock_region', None), "BEDROCK_REGION", "us-east-1")
    res_bucket = get_param_value(getattr(request, 'res_bucket', None), "RES_BUCKET", "")
    aos_index_name = get_param_value(getattr(request, 'aos_index_name', None), "INDEX_ID", "")

    if index_type == "qq" or index_type == "intention":
        supported_file_types = ["jsonl", "xlsx", "xls"]
    else:
        # Default is QD
        supported_file_types = [
            "pdf",
            "txt",
            "docx",
            "xlsx",
            "xls",
            "md",
            "html",
            "json",
            "csv",
            "png",
            "jpeg",
            "jpg",
            "webp",
        ]

    # Initialize AWS clients and get model info with local variables
    s3_client_local, dynamodb_local, etl_object_table_local, model_table_local = initialize_aws_clients(etl_object_table_name, model_table_name)
    embedding_model_info, vlm_model_info = get_model_info_local(model_table_local, group_name, chatbot_id)
    embedding_model_id = embedding_model_info.get("modelId", "default-embedding")
    
    file_iterator = S3FileIterator(
        s3_bucket, s3_prefix, supported_file_types, s3_client_local, 
        batch_file_number, batch_indice, document_language, etl_endpoint_name, 
        res_bucket, portal_bucket_name, vlm_model_info, etl_object_table_local, job_id
    )

    if operation_type == "extract_only":
        embedding_function, docsearch = None, None
    else:
        try:
            embedding_function = sm_utils.getCustomEmbeddings(
                region_name=region,
                bedrock_region=bedrock_region,
                embedding_model_info=embedding_model_info,
            )
            aws_auth = get_aws_auth(region, aos_secret)
            
            if aos_endpoint and aws_auth:
                docsearch = OpenSearchVectorSearch(
                    index_name=aos_index_name,
                    embedding_function=embedding_function,
                    opensearch_url="https://{}".format(aos_endpoint),
                    http_auth=aws_auth,
                    use_ssl=True,
                    verify_certs=True,
                    connection_class=RequestsHttpConnection,
                )
            else:
                logger.warning("OpenSearch configuration not available")
                docsearch = None
        except Exception as e:
            logger.warning(f"Could not initialize OpenSearch: {e}")
            docsearch = None

    s3_files_iterator, batch_processor, worker = create_processors_and_workers(
        operation_type,
        docsearch,
        embedding_model_id,
        file_iterator,
    )
    
    if operation_type == "create":
        ingestion_pipeline(s3_files_iterator, batch_processor, worker, False, s3_client_param, etl_table, execution_id)
    elif operation_type == "extract_only":
        ingestion_pipeline(
            s3_files_iterator, batch_processor, worker, extract_only=True, s3_client_param=s3_client_param, etl_table=etl_table, execution_id=execution_id
        )
    elif operation_type == "delete":
        delete_pipeline(s3_files_iterator, batch_processor, worker)
    elif operation_type == "update":
        # Delete the documents first
        delete_pipeline(s3_files_iterator, batch_processor, worker)

        # Then ingest the documents
        s3_files_iterator, batch_processor, worker = (
            create_processors_and_workers(
                "create", docsearch, embedding_model_id, file_iterator
            )
        )
        ingestion_pipeline(s3_files_iterator, batch_processor, worker, False, s3_client_local, etl_object_table_local, job_id)
    else:
        raise ValueError(
            "Invalid operation type. Valid types: create, delete, update, extract_only"
        )


def lambda_handler(event, context):
    """
    Lambda function handler for processing ETL requests from API Gateway
    
    Args:
        event (dict): Lambda event data containing request parameters
        context (LambdaContext): Lambda context object
        
    Returns:
        dict: Response with status and details formatted for API Gateway
    """
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Handle API Gateway request
        http_method = event.get('httpMethod', '')
        body = {}
        
        # Parse request body if present
        if 'body' in event and event['body']:
            try:
                body = json.loads(event['body'])
            except json.JSONDecodeError:
                return {
                    "statusCode": 400,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps({"error": "Invalid JSON in request body"})
                }
        
        # Create a request object from the body or query parameters
        class Request:
            def __init__(self, data):
                for key, value in data.items():
                    setattr(self, key, value)
        
        # Use body for POST requests, query parameters for GET requests
        job_id = query_params.get('job_id', context.aws_request_id)
        if http_method == 'GET':
            query_params = event.get('queryStringParameters', {}) or {}
            request = Request(query_params)
            
            # For GET requests, return status information
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({
                    "status": "success",
                    "message": "ETL API is operational",
                    "job_id": job_id
                })
            }
        else:
            request = Request(body)
            
            # Process the request
            main(request, job_id)
            
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({
                    "status": "success",
                    "message": "ETL process started successfully",
                    "job_id": job_id
                })
            }
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        traceback.print_exc()
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "status": "error",
                "message": str(e)
            })
        }
