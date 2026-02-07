"""WebSocket connection manager.

Manages connected browser clients and broadcasts messages.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WSConnectionManager:
    """Manages WebSocket connections to coach monitor UI clients.

    Provides broadcast capability and connection tracking.
    """

    def __init__(self) -> None:
        self._active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and register a new WebSocket connection.

        Args:
            websocket: The incoming WebSocket connection.
        """
        await websocket.accept()
        self._active.append(websocket)
        logger.info(
            "WebSocket client connected. Total clients: %d",
            len(self._active),
        )

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a disconnected WebSocket.

        Args:
            websocket: The disconnected WebSocket.
        """
        if websocket in self._active:
            self._active.remove(websocket)
        logger.info(
            "WebSocket client disconnected. Total clients: %d",
            len(self._active),
        )

    async def broadcast_json(self, data: dict[str, Any]) -> None:
        """Broadcast a JSON message to all connected clients.

        Disconnected clients are silently removed.

        Args:
            data: The JSON-serializable dict to send.
        """
        disconnected: list[WebSocket] = []

        for ws in self._active:
            try:
                await ws.send_json(data)
            except Exception:
                logger.debug("Failed to send to client, marking for removal")
                disconnected.append(ws)

        for ws in disconnected:
            self.disconnect(ws)

    async def broadcast_text(self, text: str) -> None:
        """Broadcast a text message to all connected clients.

        Args:
            text: The text string to send (typically JSON).
        """
        disconnected: list[WebSocket] = []

        for ws in self._active:
            try:
                await ws.send_text(text)
            except Exception:
                logger.debug("Failed to send to client, marking for removal")
                disconnected.append(ws)

        for ws in disconnected:
            self.disconnect(ws)

    @property
    def client_count(self) -> int:
        """Return the number of connected clients."""
        return len(self._active)
