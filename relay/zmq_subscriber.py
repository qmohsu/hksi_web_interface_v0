"""ZMQ subscriber: connects to HKSI_Pos PUB sockets and forwards data.

Runs in a background thread, parses messages, and invokes async callbacks
via the event loop.
"""

from __future__ import annotations

import asyncio
import logging
import time
import threading
from typing import Callable, Optional

import zmq

logger = logging.getLogger(__name__)


class ZMQSubscriber:
    """Subscribes to a ZMQ PUB socket in a background thread.

    Parses incoming multi-part messages (topic + payload) and invokes
    a callback for each received message.

    Implements reconnect with exponential backoff.
    """

    def __init__(
        self,
        endpoint: str,
        topic: str,
        name: str = "zmq-sub",
        reconnect_min_s: float = 1.0,
        reconnect_max_s: float = 30.0,
    ) -> None:
        """Initialize the subscriber.

        Args:
            endpoint: ZMQ endpoint to connect to (e.g., "tcp://localhost:5000").
            topic: ZMQ topic filter string.
            name: Human-readable name for logging.
            reconnect_min_s: Minimum reconnect backoff.
            reconnect_max_s: Maximum reconnect backoff.
        """
        self._endpoint = endpoint
        self._topic = topic
        self._name = name
        self._reconnect_min_s = reconnect_min_s
        self._reconnect_max_s = reconnect_max_s

        self._callback: Optional[Callable[[str, str], None]] = None
        self._async_callback: Optional[Callable[[str, str], asyncio.Future]] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._connected = False

        # Counters
        self.messages_received = 0
        self.errors = 0

    @property
    def connected(self) -> bool:
        """Whether the subscriber is currently connected."""
        return self._connected

    def start(
        self,
        callback: Optional[Callable[[str, str], None]] = None,
        async_callback: Optional[Callable] = None,
        loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> None:
        """Start the subscriber in a background thread.

        Provide either callback (sync) or async_callback + loop.

        Args:
            callback: Sync callback(topic: str, payload: str).
            async_callback: Async callback(topic: str, payload: str).
            loop: Event loop for scheduling async callbacks.
        """
        self._callback = callback
        self._async_callback = async_callback
        self._loop = loop
        self._running = True

        self._thread = threading.Thread(
            target=self._run_loop,
            name=self._name,
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "[%s] Started ZMQ subscriber on %s (topic=%s)",
            self._name,
            self._endpoint,
            self._topic,
        )

    def stop(self) -> None:
        """Stop the subscriber thread."""
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=5.0)
        logger.info("[%s] ZMQ subscriber stopped", self._name)

    def _run_loop(self) -> None:
        """Background thread: connect, receive, reconnect on failure."""
        context = zmq.Context()

        while self._running:
            socket = None
            try:
                socket = context.socket(zmq.SUB)
                socket.setsockopt(zmq.RCVTIMEO, 1000)  # 1s timeout
                socket.setsockopt_string(zmq.SUBSCRIBE, self._topic)
                socket.connect(self._endpoint)
                self._connected = True
                logger.info(
                    "[%s] Connected to %s", self._name, self._endpoint
                )

                while self._running:
                    try:
                        parts = socket.recv_multipart(flags=0)
                        if len(parts) >= 2:
                            topic = parts[0].decode("utf-8", errors="replace")
                            payload = parts[1].decode("utf-8", errors="replace")
                            self.messages_received += 1
                            self._dispatch(topic, payload)
                    except zmq.Again:
                        # Receive timeout — no message, keep looping
                        continue
                    except zmq.ZMQError as exc:
                        if not self._running:
                            break
                        logger.warning(
                            "[%s] ZMQ receive error: %s", self._name, exc
                        )
                        self.errors += 1
                        break  # Reconnect

            except zmq.ZMQError as exc:
                logger.error(
                    "[%s] ZMQ connection error: %s", self._name, exc
                )
                self.errors += 1
            finally:
                self._connected = False
                if socket is not None:
                    socket.close()

            # Exponential backoff reconnect
            if self._running:
                backoff = min(
                    self._reconnect_min_s * (2 ** min(self.errors, 10)),
                    self._reconnect_max_s,
                )
                logger.info(
                    "[%s] Reconnecting in %.1fs...", self._name, backoff
                )
                time.sleep(backoff)

        context.term()

    def _dispatch(self, topic: str, payload: str) -> None:
        """Dispatch a received message to the registered callback."""
        try:
            if self._async_callback and self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._async_callback(topic, payload), self._loop
                )
            elif self._callback:
                self._callback(topic, payload)
        except Exception:
            logger.exception("[%s] Error in message callback", self._name)
            self.errors += 1
