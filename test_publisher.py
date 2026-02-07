#!/usr/bin/env python3
"""
测试发布器：用于生成符合指定格式的测试数据
"""

import json
import time
import zmq
import threading
from datetime import datetime

def create_position_batch():
    """创建位置批次数据（符合指定格式）"""
    timestamp_us = int(time.time() * 1_000_000)
    
    positions = [
        {
            "device_id": 1,            # T0
            "lat": 22.3001 + (time.time() % 10) * 0.0001,
            "lon": 114.2001,
            "alt_m": 0.5,
            "source_mask": 1           # UWB
        },
        {
            "device_id": 2,            # T1
            "lat": 22.3002 + (time.time() % 10) * 0.0001,
            "lon": 114.2002,
            "alt_m": 0.6,
            "source_mask": 5           # UWB+GNSS
        },
        {
            "device_id": 101,          # A0
            "lat": 22.3000,
            "lon": 114.2000,
            "alt_m": 0.0,
            "source_mask": 4           # GNSS
        },
        {
            "device_id": 102,          # A1
            "lat": 22.3010,
            "lon": 114.2010,
            "alt_m": 0.0,
            "source_mask": 4           # GNSS
        }
    ]
    
    return {
        "timestamp_us": timestamp_us,
        "positions": positions
    }

def create_gate_metrics_batch():
    """创建门线指标批次数据（符合指定格式）"""
    timestamp_us = int(time.time() * 1_000_000)
    
    metrics = [
        {
            "tag_id": "T0",
            "gate_id": "start_line",
            "d_perp_m": -5.2 + (time.time() % 10) * 0.1,
            "s_along": 0.45,
            "time_to_line_s": 1.04,
            "crossing_event": "NO_CROSSING",
            "confidence": 0.0
        },
        {
            "tag_id": "T1",
            "gate_id": "finish_line",
            "d_perp_m": 3.1,
            "s_along": 0.78,
            "time_to_line_s": 0.85,
            "crossing_event": "CROSSING_RIGHT",
            "confidence": 0.92
        }
    ]
    
    return {
        "timestamp_us": timestamp_us,
        "metrics": metrics
    }

def publish_positions():
    """发布位置数据到端口5000"""
    context = zmq.Context()
    socket = context.socket(zmq.PUB)
    socket.bind("tcp://*:5000")
    
    print("位置发布器已启动，绑定到 tcp://*:5000")
    
    try:
        while True:
            batch = create_position_batch()
            message = json.dumps(batch).encode('utf-8')
            socket.send_multipart([b"position", message])
            print(f"已发布位置数据: {len(batch['positions'])} 个设备")
            time.sleep(0.1)  # 10 Hz
    except KeyboardInterrupt:
        print("停止位置发布器")
        socket.close()
        context.term()

def publish_gate_metrics():
    """发布门线指标数据到端口5001"""
    context = zmq.Context()
    socket = context.socket(zmq.PUB)
    socket.bind("tcp://*:5001")
    
    print("门线指标发布器已启动，绑定到 tcp://*:5001")
    
    try:
        while True:
            batch = create_gate_metrics_batch()
            message = json.dumps(batch).encode('utf-8')
            socket.send_multipart([b"gate", message])
            print(f"已发布门线指标: {len(batch['metrics'])} 个指标")
            time.sleep(0.1)  # 10 Hz
    except KeyboardInterrupt:
        print("停止门线指标发布器")
        socket.close()
        context.term()

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) != 2:
        print("用法: python test_publisher.py [positions|gate|both]")
        sys.exit(1)
    
    mode = sys.argv[1]
    
    if mode == "positions":
        publish_positions()
    elif mode == "gate":
        publish_gate_metrics()
    elif mode == "both":
        # 启动两个线程
        pos_thread = threading.Thread(target=publish_positions, daemon=True)
        gate_thread = threading.Thread(target=publish_gate_metrics, daemon=True)
        
        pos_thread.start()
        gate_thread.start()
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("停止所有发布器")
    else:
        print("无效模式，使用 positions, gate 或 both")
        sys.exit(1)