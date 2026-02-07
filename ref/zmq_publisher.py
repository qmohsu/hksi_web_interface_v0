"""
ZMQ Publisher: Publish position batches via ZMQ PUB socket.

Publishes PositionBatch messages at fixed rate (10 Hz) to downstream consumers:
- ZMQ PUB socket for fan-out to multiple subscribers
- Heartbeat mechanism for connectivity checking
- Rate limiting and statistics

Reference: Design Doc Section 9 (Output Publishing), dev_plan.md M0, M6
Rule 05: Observability - track publish rates and failures
"""

import threading
import time
import logging
from typing import Optional
from dataclasses import dataclass

try:
    import zmq
except ImportError:
    zmq = None
    logging.warning("ZMQ not installed. Install with: pip install pyzmq")

from proto.output_position import PositionBatch
from utils.time_converter import get_wall_time_us
from metrics import get_metrics

logger = logging.getLogger(__name__)


@dataclass
class ZMQPublisherConfig:
    """
    Configuration for ZMQ publisher.
    
    Attributes:
        bind_address: ZMQ address to bind to (e.g., "tcp://*:5000")
        publish_rate_hz: Target publish rate in Hz (default 10 Hz)
        hwm: High water mark for ZMQ socket (max queued messages)
        enable_heartbeat: Enable periodic heartbeat publishing
        heartbeat_interval_s: Heartbeat interval in seconds
    """
    
    bind_address: str = "tcp://*:5000"
    publish_rate_hz: float = 10.0
    hwm: int = 100  # Small buffer - drop old data if subscribers slow
    enable_heartbeat: bool = True
    heartbeat_interval_s: float = 1.0
    
    @property
    def publish_interval_s(self) -> float:
        """Publish interval in seconds."""
        return 1.0 / self.publish_rate_hz


class ZMQPublisher:
    """
    ZMQ-based position batch publisher.
    
    Publishes PositionBatch messages via ZMQ PUB socket at fixed rate.
    Provides fan-out to multiple subscribers.
    
    Usage:
        publisher = ZMQPublisher(config)
        publisher.start()
        
        # Publish position batch
        batch = PositionBatch(...)
        publisher.publish_batch(batch)
        
        publisher.stop()
    
    Thread Safety:
        - Thread-safe for publish_batch() calls
        - Internal socket operations protected by lock
    
    Heartbeat:
        - If enabled, publishes heartbeat message periodically
        - Allows subscribers to detect connectivity
    """
    
    def __init__(self, config: Optional[ZMQPublisherConfig] = None):
        """
        Initialize ZMQ publisher.
        
        Args:
            config: Publisher configuration (uses defaults if None)
            
        Raises:
            ImportError: If pyzmq is not installed
        """
        if zmq is None:
            raise ImportError(
                "pyzmq not installed. Install with: pip install pyzmq"
            )
        
        self.config = config or ZMQPublisherConfig()
        self.metrics = get_metrics()
        
        # ZMQ context and socket
        self._context: Optional[zmq.Context] = None
        self._socket: Optional[zmq.Socket] = None
        self._socket_lock = threading.Lock()
        
        # Heartbeat thread
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._running = False
        self._shutdown_event = threading.Event()
        
        # Statistics
        self._total_published = 0
        self._last_publish_time: Optional[int] = None
        
        logger.info(
            f"ZMQPublisher initialized: address={self.config.bind_address}, "
            f"rate={self.config.publish_rate_hz}Hz"
        )
    
    def start(self) -> bool:
        """
        Start ZMQ publisher.
        
        Returns:
            True if started successfully, False otherwise
            
        Notes:
            - Binds ZMQ PUB socket to configured address
            - Starts heartbeat thread if enabled
            - Idempotent - safe to call multiple times
        """
        if self._running:
            logger.warning("ZMQPublisher already running")
            return True
        
        try:
            # Create ZMQ context
            self._context = zmq.Context()
            
            # Create PUB socket
            self._socket = self._context.socket(zmq.PUB)
            
            # Configure socket
            self._socket.setsockopt(zmq.SNDHWM, self.config.hwm)
            self._socket.setsockopt(zmq.LINGER, 1000)  # 1s linger on close
            
            # Bind socket
            self._socket.bind(self.config.bind_address)
            
            # Start heartbeat thread if enabled
            self._running = True
            self._shutdown_event.clear()
            
            if self.config.enable_heartbeat:
                self._heartbeat_thread = threading.Thread(
                    target=self._heartbeat_loop,
                    name="ZMQPublisher-Heartbeat",
                    daemon=True
                )
                self._heartbeat_thread.start()
            
            logger.info(f"ZMQPublisher started on {self.config.bind_address}")
            self.metrics.increment('zmq_publisher_starts')
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to start ZMQPublisher: {e}", exc_info=True)
            self.metrics.increment('zmq_publisher_start_failures')
            self._cleanup()
            return False
    
    def stop(self, timeout: float = 5.0):
        """
        Stop ZMQ publisher gracefully.
        
        Args:
            timeout: Maximum time to wait for shutdown (seconds)
            
        Notes:
            - Signals heartbeat thread to stop
            - Closes socket and context
        """
        if not self._running:
            logger.warning("ZMQPublisher not running")
            return
        
        logger.info("Stopping ZMQPublisher...")
        
        # Signal shutdown
        self._running = False
        self._shutdown_event.set()
        
        # Wait for heartbeat thread
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            self._heartbeat_thread.join(timeout=timeout)
            if self._heartbeat_thread.is_alive():
                logger.warning("Heartbeat thread did not stop within timeout")
        
        # Cleanup
        self._cleanup()
        
        logger.info("ZMQPublisher stopped")
        self.metrics.increment('zmq_publisher_stops')
    
    def publish_batch(self, batch: PositionBatch) -> bool:
        """
        Publish position batch.
        
        Args:
            batch: PositionBatch to publish
            
        Returns:
            True if published successfully, False otherwise
            
        Notes:
            - Thread-safe
            - Non-blocking send (drops if HWM reached)
            - Records metrics
        """
        if not self._running:
            logger.warning("Cannot publish - publisher not running")
            return False
        
        try:
            # Serialize batch to bytes (simplified - would use protobuf in practice)
            # For now, create a simple format
            msg_bytes = self._serialize_batch(batch)
            
            # Publish with topic "position"
            with self._socket_lock:
                self._socket.send_multipart([b"position", msg_bytes], flags=zmq.NOBLOCK)
            
            # Update statistics
            self._total_published += 1
            self._last_publish_time = batch.server_timestamp
            
            self.metrics.increment('zmq_publisher_batches_sent')
            self.metrics.record_histogram(
                'zmq_publisher_batch_size',
                len(batch.positions)
            )
            self.metrics.record_histogram(
                'zmq_publisher_message_size_bytes',
                len(msg_bytes)
            )
            
            return True
            
        except zmq.Again:
            # HWM reached - drop message
            logger.warning("ZMQPublisher HWM reached, dropping batch")
            self.metrics.increment('zmq_publisher_hwm_drops')
            return False
            
        except Exception as e:
            logger.error(f"ZMQPublisher error: {e}", exc_info=True)
            self.metrics.increment('zmq_publisher_errors')
            return False
    
    def publish_heartbeat(self) -> bool:
        """
        Publish heartbeat message.
        
        Returns:
            True if published successfully
            
        Notes:
            - Heartbeat contains timestamp only
            - Published on topic "heartbeat"
        """
        if not self._running:
            return False
        
        try:
            t_now = get_wall_time_us()
            heartbeat_msg = f"{t_now}".encode('utf-8')
            
            with self._socket_lock:
                self._socket.send_multipart([b"heartbeat", heartbeat_msg], flags=zmq.NOBLOCK)
            
            self.metrics.increment('zmq_publisher_heartbeats_sent')
            return True
            
        except Exception as e:
            logger.warning(f"Heartbeat publish error: {e}")
            return False
    
    def _heartbeat_loop(self):
        """
        Heartbeat loop (runs in background thread).
        
        Publishes periodic heartbeat messages for connectivity checking.
        """
        logger.info("ZMQPublisher heartbeat loop started")
        
        while self._running:
            try:
                self.publish_heartbeat()
                time.sleep(self.config.heartbeat_interval_s)
                
            except Exception as e:
                if self._running:
                    logger.error(f"Heartbeat loop error: {e}")
                    time.sleep(1.0)
        
        logger.info("ZMQPublisher heartbeat loop stopped")
    
    def _serialize_batch(self, batch: PositionBatch) -> bytes:
        """
        Serialize PositionBatch to bytes.
        
        Args:
            batch: PositionBatch to serialize
            
        Returns:
            Serialized bytes
            
        Notes:
            - This is a placeholder - should use protobuf in production
            - Current implementation creates simple JSON-like format
        """
        # Placeholder: Create simple text format
        # In production, use output_position_pb2.PositionBatch().SerializeToString()
        
        lines = [
            f"SERVER_TS:{batch.server_timestamp}",
            f"COUNT:{len(batch.positions)}"
        ]
        
        for pos in batch.positions:
            lines.append(
                f"POS:{pos.device_id}:{pos.latitude:.8f}:{pos.longitude:.8f}:"
                f"{pos.altitude:.3f}:{pos.source_mask}:{pos.device_timestamp}"
            )
        
        return "\n".join(lines).encode('utf-8')
    
    def _cleanup(self):
        """Clean up ZMQ resources."""
        # Close socket
        if self._socket:
            try:
                self._socket.close()
            except Exception as e:
                logger.warning(f"Error closing socket: {e}")
            self._socket = None
        
        # Terminate context
        if self._context:
            try:
                self._context.term()
            except Exception as e:
                logger.warning(f"Error terminating context: {e}")
            self._context = None
    
    def get_statistics(self) -> dict:
        """
        Get publisher statistics.
        
        Returns:
            Dictionary with statistics
        """
        return {
            'running': self._running,
            'total_published': self._total_published,
            'last_publish_time': self._last_publish_time,
            'bind_address': self.config.bind_address,
            'publish_rate_hz': self.config.publish_rate_hz,
        }
    
    def __repr__(self) -> str:
        """String representation for debugging."""
        return (
            f"ZMQPublisher(address={self.config.bind_address}, "
            f"running={self._running}, published={self._total_published})"
        )


# =============================================================================
# Example Usage
# =============================================================================

if __name__ == "__main__":
    import sys
    
    print("ZMQPublisher Example\n" + "=" * 50)
    
    # Check if ZMQ is available
    if zmq is None:
        print("ERROR: pyzmq not installed")
        print("Install with: pip install pyzmq")
        sys.exit(1)
    
    # Create publisher
    config = ZMQPublisherConfig(
        bind_address="tcp://*:5000",
        publish_rate_hz=10.0,
        enable_heartbeat=True
    )
    publisher = ZMQPublisher(config)
    
    # Start publisher
    if not publisher.start():
        print("Failed to start publisher")
        sys.exit(1)
    
    print(f"\nPublisher started on {config.bind_address}")
    print(f"Publishing at {config.publish_rate_hz} Hz")
    print("Press Ctrl+C to stop")
    
    try:
        # Publish loop
        from proto.output_position import Position, PositionBatch, SourceMask
        
        message_count = 0
        while True:
            # Create mock position batch
            positions = []
            
            # Mock tag position
            positions.append(Position(
                device_id=1,  # T0
                latitude=22.3193 + message_count * 0.0001,
                longitude=114.1694,
                altitude=0.0,
                source_mask=SourceMask.UWB,
                device_timestamp=get_wall_time_us()
            ))
            
            # Mock anchor position
            positions.append(Position(
                device_id=101,  # A0
                latitude=22.3193,
                longitude=114.1694,
                altitude=0.0,
                source_mask=SourceMask.GNSS,
                device_timestamp=get_wall_time_us()
            ))
            
            batch = PositionBatch(
                server_timestamp=get_wall_time_us(),
                positions=positions
            )
            
            # Publish
            if publisher.publish_batch(batch):
                message_count += 1
                print(f"Published batch #{message_count} with {len(positions)} positions")
            
            # Wait for next publish interval
            time.sleep(config.publish_interval_s)
            
            # Show statistics periodically
            if message_count % 50 == 0:
                stats = publisher.get_statistics()
                print(f"\nStatistics: {stats}")
    
    except KeyboardInterrupt:
        print("\n\nStopping publisher...")
        publisher.stop()
        print("Publisher stopped")
