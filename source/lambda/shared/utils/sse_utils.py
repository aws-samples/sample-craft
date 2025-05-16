"""Module for handling sse streaming requests."""
import uuid
import json
import asyncio
from typing import Dict
from asyncio import Queue

LOOP = None

class SSEManager:
    """SSEManager for handling sse streaming requests."""
    _current_client_id = None  # Class-level variable
 
    def __init__(self):
        self.clients: Dict[str, Queue] = {}

    @classmethod
    def get_current_client_id(cls) -> str:
        """Get the current client ID."""
        return cls._current_client_id

    @classmethod
    def set_current_client_id(cls, client_id: str):
        """Set the current client ID."""
        cls._current_client_id = client_id

    def connect(self) -> str:
        """Connect a new client and return its client_id."""
        client_id = str(uuid.uuid4())
        self.clients[client_id] = Queue()
        self.set_current_client_id(client_id)
        return client_id

    def disconnect(self, client_id: str):
        """Disconnect a client by its client_id."""
        self.clients.pop(client_id, None)
        if self._current_client_id == client_id:
            self.set_current_client_id(None)

    def get_client_queue(self, client_id: str) -> Queue:
        """Get the queue of a client by its client_id."""
        return self.clients[client_id]
    
    def send_message(self, message: dict):
        """Send message to target client."""
        async def send_message_with_loop(client_id: str, message: str):
            """Send a message to a client by its client_id."""
            if client_id in self.clients:
                await self.clients[client_id].put(message)
        asyncio.run_coroutine_threadsafe(
            send_message_with_loop(get_current_client_id(), json.dumps(message)), LOOP)
sse_manager = SSEManager()
get_current_client_id = sse_manager.get_current_client_id
