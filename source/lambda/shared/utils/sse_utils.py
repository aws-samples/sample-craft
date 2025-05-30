"""Module for handling sse streaming requests."""
import uuid
import json
import asyncio
from typing import Dict
from asyncio import Queue
from shared.utils.logger_utils import get_logger

LOOP = None
logger = get_logger("sse_utils")

class SSEManager:
    """SSEManager for handling sse streaming requests."""
 
    def __init__(self):
        self.clients: Dict[str, Queue] = {}
        self._current_client_id = None

    def connect(self) -> str:
        """Connect a new client and return its client_id."""
        client_id = str(uuid.uuid4())
        self.clients[client_id] = Queue()
        self._current_client_id = client_id
        return client_id

    def disconnect(self, client_id: str):
        """Disconnect a client by its client_id."""
        self.clients.pop(client_id, None)
        if self._current_client_id == client_id:
            self._current_client_id = None

    def get_current_client_id(self) -> str:
        """Get the current client ID."""
        return self._current_client_id

    def get_client_queue(self, client_id: str) -> Queue:
        """Get the queue of a client by its client_id."""
        return self.clients[client_id]
    
    def set_loop(self, loop: asyncio.AbstractEventLoop):
        """Set the global event loop for SSE operations.
        
        Args:
            loop: The asyncio event loop to use for SSE operations
        """
        global LOOP
        LOOP = loop
        logger.info("SSE event loop set")
    
    def send_message(self, message: dict, client_id: str = None):
        """Send message to target client.
        
        Args:
            message: The message to send
            client_id: The ID of the client to send the message to
        """
        if client_id is None:
            return
            
        async def send_message_with_loop(client_id: str, message: str):
            """Send a message to a client by its client_id."""
            if client_id in self.clients:
                await self.clients[client_id].put(message)
                
        if LOOP is None:
            return

        asyncio.run_coroutine_threadsafe(
            send_message_with_loop(client_id, json.dumps(message)), LOOP)

sse_manager = SSEManager()
