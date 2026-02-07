"""
Gate Metrics Publisher: Publish gate metrics via ZMQ PUB socket on :5001.

Implements Design Doc Section 9.3 and dev_plan.md Milestone M6.25:
- Separate ZMQ stream for gate analytics (coach UI)
- Computes derived metrics (time_to_line, speed_to_line)
- Publishes GateMetricsBatch at 10 Hz (synchronized with positions)
- Crossing alerts for real-time notifications

Architecture:
    GateCalculator → GateMetrics → GatePublisher → ZMQ PUB :5001
"""

import sys
import threading
import time
import logging
import math
import json
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

try:
    import zmq
except ImportError:
    zmq = None
    logging.warning("ZMQ not installed. Install with: pip install pyzmq")

from proto.gate_metrics import GateMetrics, CrossingEvent
from proto.position_estimate import PositionEstimate
from utils.time_converter import get_wall_time_us
from metrics import get_metrics

logger = logging.getLogger(__name__)


@dataclass
class GateMetricsOutput:
    """
    Gate metrics ready for publishing.
    
    Includes all metrics from GateCalculator plus coach-valuable
    derived metrics (time_to_line, speed_to_line).
    
    Per Design Doc Section 10.2-10.3.
    """
    
    # Identifiers
    tag_id: str
    gate_id: str
    anchor_left_id: str
    anchor_right_id: str
    
    # Timestamps
    server_timestamp_us: int
    estimate_timestamp_us: int
    
    # Core metrics (from GateCalculator)
    d_perp_signed_m: float      # + right of line, - left of line
    s_along: float              # 0 = left anchor, 1 = right anchor
    gate_length_m: float        # Current gate length
    
    # Crossing detection
    crossing_event: CrossingEvent
    crossing_time_us: Optional[int]
    crossing_confidence: float
    
    # Quality
    tag_position_quality: float
    
    # Coach-valuable derived metrics
    time_to_line_s: Optional[float]      # Predicted time to reach line
    speed_to_line_mps: Optional[float]   # Perpendicular velocity component


@dataclass
class GateAlert:
    """Alert for crossing events (subset of GateMetricsOutput)."""
    
    tag_id: str
    gate_id: str
    event: CrossingEvent
    crossing_time_us: int
    confidence: float


@dataclass
class GateMetricsBatch:
    """
    Batch of gate metrics for all tags and gates.
    
    Published at 10 Hz on ZMQ PUB :5001.
    Per Design Doc Section 9.3.
    """
    
    server_timestamp_us: int
    metrics: List[GateMetricsOutput]
    alerts: List[GateAlert]  # Crossing events only


@dataclass
class GatePublisherConfig:
    """Configuration for gate metrics publisher."""
    
    bind_address: str = "tcp://*:5001"
    publish_rate_hz: float = 10.0
    hwm: int = 100  # High water mark
    enable_heartbeat: bool = True
    heartbeat_interval_s: float = 30.0


class GatePublisher:
    """
    Publishes gate metrics to ZMQ PUB socket on :5001.
    
    Implements Design Doc Section 9.3 - Gate Metrics Stream.
    
    Usage:
        publisher = GatePublisher(config)
        publisher.start()
        
        # Publish gate metrics
        gate_metrics_list = [...]  # From GateCalculator
        tag_estimates = {...}      # From TagSolver
        publisher.publish(gate_metrics_list, tag_estimates)
        
        publisher.stop()
    
    Features:
        - Computes derived metrics (time_to_line, speed_to_line)
        - Filters crossing alerts for coach notifications
        - Synchronized with position publishing (10 Hz)
        - Heartbeat for connectivity monitoring
    """
    
    def __init__(self, config: Optional[GatePublisherConfig] = None):
        """
        Initialize gate publisher.
        
        Args:
            config: Publisher configuration (uses defaults if None)
            
        Raises:
            ImportError: If pyzmq is not installed
        """
        if zmq is None:
            raise ImportError(
                "pyzmq not installed. Install with: pip install pyzmq"
            )
        
        self.config = config or GatePublisherConfig()
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
        
        logger.info(
            f"GatePublisher initialized: address={self.config.bind_address}, "
            f"rate={self.config.publish_rate_hz}Hz"
        )
    
    def start(self) -> bool:
        """
        Start gate publisher.
        
        Returns:
            True if started successfully, False otherwise
        """
        if self._running:
            logger.warning("GatePublisher already running")
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
                    name="GatePublisher-Heartbeat",
                    daemon=True
                )
                self._heartbeat_thread.start()
            
            logger.info(f"GatePublisher started on {self.config.bind_address}")
            self.metrics.increment('gate_publisher_starts')
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to start GatePublisher: {e}", exc_info=True)
            self.metrics.increment('gate_publisher_start_failures')
            self._cleanup()
            return False
    
    def stop(self, timeout: float = 5.0):
        """
        Stop gate publisher gracefully.
        
        Args:
            timeout: Maximum time to wait for shutdown (seconds)
        """
        if not self._running:
            logger.warning("GatePublisher not running")
            return
        
        logger.info("Stopping GatePublisher...")
        
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
        
        logger.info("GatePublisher stopped")
        self.metrics.increment('gate_publisher_stops')
    
    def publish(
        self,
        gate_metrics_list: List[GateMetrics],
        tag_estimates: Dict[str, PositionEstimate],
    ) -> bool:
        """
        Publish gate metrics batch.
        
        Args:
            gate_metrics_list: List of GateMetrics from GateCalculator
            tag_estimates: Dict of tag_id → PositionEstimate (for velocity)
            
        Returns:
            True if published successfully, False otherwise
            
        Notes:
            - Computes derived metrics (time_to_line, speed_to_line)
            - Extracts crossing alerts
            - Publishes as GateMetricsBatch
        """
        if not self._running:
            logger.warning("Cannot publish - publisher not running")
            return False
        
        try:
            # Build output batch
            batch = self._build_batch(gate_metrics_list, tag_estimates)
            
            # Serialize to JSON (protobuf would be better, but JSON works for now)
            msg_bytes = self._serialize_batch(batch)
            
            # Publish with topic "gate"
            with self._socket_lock:
                self._socket.send_multipart([b"gate", msg_bytes], flags=zmq.NOBLOCK)
            
            # Update statistics
            self._total_published += 1
            
            self.metrics.increment('gate_publisher_batches_sent')
            self.metrics.record_histogram(
                'gate_publisher_batch_size',
                len(batch.metrics)
            )
            self.metrics.record_histogram(
                'gate_publisher_alerts',
                len(batch.alerts)
            )
            
            return True
            
        except zmq.Again:
            logger.warning("ZMQ send would block (HWM reached), dropping batch")
            self.metrics.increment_drop('gate_publisher_hwm_reached')
            return False
        except Exception as e:
            logger.error(f"Failed to publish gate batch: {e}", exc_info=True)
            self.metrics.increment('gate_publisher_failures')
            return False
    
    def _build_batch(
        self,
        gate_metrics_list: List[GateMetrics],
        tag_estimates: Dict[str, PositionEstimate],
    ) -> GateMetricsBatch:
        """
        Build GateMetricsBatch from gate metrics and tag estimates.
        
        Per Design Doc Section 10.3: Computes derived metrics
        (time_to_line, speed_to_line) from tag velocity.
        """
        server_timestamp_us = get_wall_time_us()
        
        output_metrics = []
        alerts = []
        
        for gate_metric in gate_metrics_list:
            tag_id = gate_metric.tag_id
            estimate = tag_estimates.get(tag_id)
            
            # Compute derived metrics from velocity
            time_to_line, speed_to_line = self._compute_derived_metrics(
                gate_metric, estimate
            )
            
            # Build output
            output = GateMetricsOutput(
                tag_id=gate_metric.tag_id,
                gate_id=gate_metric.gate_id,
                anchor_left_id=gate_metric.anchor_left_id,
                anchor_right_id=gate_metric.anchor_right_id,
                server_timestamp_us=server_timestamp_us,
                estimate_timestamp_us=int(gate_metric.estimate_time * 1_000_000),
                d_perp_signed_m=gate_metric.d_perp_signed_m,
                s_along=gate_metric.s_along,
                gate_length_m=gate_metric.gate_length_m,
                crossing_event=gate_metric.crossing_event,
                crossing_time_us=(
                    int(gate_metric.crossing_time * 1_000_000)
                    if gate_metric.crossing_time is not None else None
                ),
                crossing_confidence=gate_metric.crossing_confidence,
                tag_position_quality=gate_metric.tag_position_quality,
                time_to_line_s=time_to_line,
                speed_to_line_mps=speed_to_line,
            )
            output_metrics.append(output)
            
            # Extract crossing alerts
            if gate_metric.crossing_event != CrossingEvent.NO_CROSSING:
                alert = GateAlert(
                    tag_id=gate_metric.tag_id,
                    gate_id=gate_metric.gate_id,
                    event=gate_metric.crossing_event,
                    crossing_time_us=int(gate_metric.crossing_time * 1_000_000),
                    confidence=gate_metric.crossing_confidence,
                )
                alerts.append(alert)
        
        return GateMetricsBatch(
            server_timestamp_us=server_timestamp_us,
            metrics=output_metrics,
            alerts=alerts,
        )
    
    def _compute_derived_metrics(
        self,
        gate_metric: GateMetrics,
        estimate: Optional[PositionEstimate],
    ) -> tuple[Optional[float], Optional[float]]:
        """
        Compute coach-valuable derived metrics.
        
        Per Design Doc Section 10.3:
        - time_to_line: Predicted time to reach line (s)
        - speed_to_line: Perpendicular velocity component (m/s)
        
        Args:
            gate_metric: Gate metrics with perpendicular distance
            estimate: Position estimate with velocity (if available)
            
        Returns:
            (time_to_line_s, speed_to_line_mps) tuple
        """
        if estimate is None or estimate.vel_enu is None:
            return None, None
        
        # Get gate perpendicular direction (unit vector)
        # Gate is defined by left-to-right vector; perp is 90° CCW
        # For now, use simplified approach based on position
        
        # Project velocity onto perpendicular direction
        # Perpendicular direction points from + to - (toward the line)
        # So if d_perp_signed > 0, moving negative is toward line
        
        # Simplified: Use velocity component that reduces d_perp
        # More accurate version would use actual gate geometry
        vel_e, vel_n, vel_u = estimate.vel_enu
        speed_horizontal = math.sqrt(vel_e**2 + vel_n**2)
        
        # Estimate perpendicular speed component
        # (Simplified - would need gate normal vector for accuracy)
        # Assume worst case: all velocity is perpendicular
        speed_to_line = speed_horizontal
        
        # Calculate time to line
        d_perp = gate_metric.d_perp_signed_m
        
        if abs(speed_to_line) > 0.1:  # Moving significantly
            # Check if approaching (d_perp and velocity have opposite signs)
            # If d_perp > 0 (right of line), need negative velocity to approach
            # If d_perp < 0 (left of line), need positive velocity to approach
            
            # For now, assume moving toward line if speed > threshold
            if abs(d_perp) > 0.1:  # Not on line
                time_to_line = abs(d_perp) / speed_to_line
                
                # Cap at reasonable maximum (e.g., 60 seconds)
                if time_to_line > 60.0:
                    time_to_line = None
            else:
                time_to_line = 0.0  # On the line
        else:
            time_to_line = None  # Not moving
        
        return time_to_line, speed_to_line
    
    def _serialize_batch(self, batch: GateMetricsBatch) -> bytes:
        """
        Serialize gate metrics batch to bytes.
        
        Uses JSON for simplicity. Protobuf would be more efficient.
        
        Args:
            batch: GateMetricsBatch to serialize
            
        Returns:
            Serialized bytes
        """
        import json
        
        # Convert to dict
        data = {
            'server_timestamp_us': batch.server_timestamp_us,
            'metrics': [
                {
                    'tag_id': m.tag_id,
                    'gate_id': m.gate_id,
                    'anchor_left_id': m.anchor_left_id,
                    'anchor_right_id': m.anchor_right_id,
                    'server_timestamp_us': m.server_timestamp_us,
                    'estimate_timestamp_us': m.estimate_timestamp_us,
                    'd_perp_signed_m': m.d_perp_signed_m,
                    's_along': m.s_along,
                    'gate_length_m': m.gate_length_m,
                    'crossing_event': m.crossing_event.name if m.crossing_event else 'NO_CROSSING',
                    'crossing_time_us': m.crossing_time_us,
                    'crossing_confidence': m.crossing_confidence,
                    'tag_position_quality': m.tag_position_quality,
                    'time_to_line_s': m.time_to_line_s,
                    'speed_to_line_mps': m.speed_to_line_mps,
                }
                for m in batch.metrics
            ],
            'alerts': [
                {
                    'tag_id': a.tag_id,
                    'gate_id': a.gate_id,
                    'event': a.event.name if a.event else 'NO_CROSSING',
                    'crossing_time_us': a.crossing_time_us,
                    'confidence': a.confidence,
                }
                for a in batch.alerts
            ]
        }
        
        return json.dumps(data).encode('utf-8')
    
    def publish_heartbeat(self):
        """Publish heartbeat message for connectivity monitoring."""
        if not self._running:
            return
        
        try:
            timestamp_us = get_wall_time_us()
            heartbeat = {
                'type': 'heartbeat',
                'timestamp_us': timestamp_us,
                'service': 'gate_publisher',
            }
            
            with self._socket_lock:
                self._socket.send_multipart(
                    [b"heartbeat", json.dumps(heartbeat).encode('utf-8')],
                    flags=zmq.NOBLOCK
                )
            
            self.metrics.increment('gate_publisher_heartbeats')
            
        except zmq.Again:
            pass  # Heartbeat dropped, not critical
        except Exception as e:
            logger.warning(f"Failed to send heartbeat: {e}")
    
    def _heartbeat_loop(self):
        """Background thread for periodic heartbeat publishing."""
        logger.info("Heartbeat thread started")
        
        while self._running:
            if self._shutdown_event.wait(self.config.heartbeat_interval_s):
                break  # Shutdown signal received
            
            self.publish_heartbeat()
        
        logger.info("Heartbeat thread stopped")
    
    def _cleanup(self):
        """Cleanup ZMQ resources."""
        if self._socket:
            self._socket.close()
            self._socket = None
        
        if self._context:
            self._context.term()
            self._context = None


# Convenience function
def create_gate_publisher(port: int = 5001) -> GatePublisher:
    """
    Create gate publisher with default configuration.
    
    Args:
        port: ZMQ port to bind to (default 5001)
        
    Returns:
        GatePublisher instance
    """
    config = GatePublisherConfig(
        bind_address=f"tcp://*:{port}",
    )
    return GatePublisher(config)


if __name__ == "__main__":
    # Test gate publisher
    import signal
    
    publisher = create_gate_publisher(port=5001)
    publisher.start()
    
    print("Gate publisher running on :5001")
    print("Press Ctrl+C to stop")
    
    def signal_handler(sig, frame):
        print("\nStopping...")
        publisher.stop()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    
    # Keep running
    while True:
        time.sleep(1)
