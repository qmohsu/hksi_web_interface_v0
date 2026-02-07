#!/usr/bin/env python3
"""
测试数据发布器：连接到5000和5001端口并发布符合格式的测试数据
"""

import json
import time
import zmq
import threading
import random
from datetime import datetime

class TestDataPublisher:
    def __init__(self):
        self.context = zmq.Context()
        self.position_socket = None
        self.gate_socket = None
        
    def start_publishers(self):
        """启动发布器"""
        # 位置数据发布器 (端口5000)
        self.position_socket = self.context.socket(zmq.PUB)
        self.position_socket.bind("tcp://*:5000")
        
        # 门线指标发布器 (端口5001)  
        self.gate_socket = self.context.socket(zmq.PUB)
        self.gate_socket.bind("tcp://*:5001")
        
        print("测试数据发布器已启动:")
        print("- 位置数据发布到: tcp://*:5000")
        print("- 门线指标发布到: tcp://*:5001")
        print("按 Ctrl+C 停止发布")
        
    def stop_publishers(self):
        """停止发布器"""
        if self.position_socket:
            self.position_socket.close()
        if self.gate_socket:
            self.gate_socket.close()
        self.context.term()
        print("测试数据发布器已停止")
        
    def create_position_batch(self):
        """创建位置批次数据（符合指定格式）"""
        timestamp_us = int(time.time() * 1_000_000)
        
        positions = []
        
        # 创建2个标签 (T0=1, T1=2)
        for i in range(2):
            device_id = i + 1  # 1, 2
            # 模拟移动的标签
            lat = 22.3001 + (time.time() % 100) * 0.00001 + random.uniform(-0.00001, 0.00001)
            lon = 114.2001 + random.uniform(-0.00001, 0.00001)
            
            positions.append({
                "device_id": device_id,
                "lat": lat,
                "lon": lon,
                "alt_m": 0.5 + random.uniform(-0.1, 0.1),
                "source_mask": 5 if i == 1 else 1  # T1有UWB+GNSS, T0只有UWB
            })
        
        # 创建2个锚点 (A0=101, A1=102)
        anchor_positions = [
            (22.3000, 114.2000),  # A0
            (22.3010, 114.2010)   # A1
        ]
        
        for i, (lat, lon) in enumerate(anchor_positions):
            device_id = 101 + i  # 101, 102
            positions.append({
                "device_id": device_id,
                "lat": lat + random.uniform(-0.000001, 0.000001),
                "lon": lon + random.uniform(-0.000001, 0.000001),
                "alt_m": 0.0,
                "source_mask": 4  # GNSS only
            })
        
        return {
            "timestamp_us": timestamp_us,
            "positions": positions
        }
    
    def create_gate_metrics_batch(self):
        """创建门线指标批次数据（符合指定格式）"""
        timestamp_us = int(time.time() * 1_000_000)
        
        metrics = []
        
        # T0 的门线指标
        d_perp_t0 = -5.0 + (time.time() % 20) * 0.2  # 从-5到-1变化
        crossing_event_t0 = "CROSSING_RIGHT" if d_perp_t0 > 0 else "NO_CROSSING"
        
        metrics.append({
            "tag_id": "T0",
            "gate_id": "start_line",
            "d_perp_m": d_perp_t0,
            "s_along": 0.45 + random.uniform(-0.05, 0.05),
            "time_to_line_s": max(0.1, 2.0 - abs(d_perp_t0) * 0.3),
            "crossing_event": crossing_event_t0,
            "confidence": 0.95 if crossing_event_t0 != "NO_CROSSING" else 0.0
        })
        
        # T1 的门线指标
        d_perp_t1 = 3.0 - (time.time() % 15) * 0.2  # 从3到0变化
        crossing_event_t1 = "CROSSING_LEFT" if d_perp_t1 < 0 else "NO_CROSSING"
        
        metrics.append({
            "tag_id": "T1",
            "gate_id": "finish_line",
            "d_perp_m": d_perp_t1,
            "s_along": 0.78 + random.uniform(-0.05, 0.05),
            "time_to_line_s": max(0.1, 1.5 - abs(d_perp_t1) * 0.4),
            "crossing_event": crossing_event_t1,
            "confidence": 0.92 if crossing_event_t1 != "NO_CROSSING" else 0.0
        })
        
        return {
            "timestamp_us": timestamp_us,
            "metrics": metrics
        }
    
    def publish_data(self):
        """发布测试数据"""
        try:
            while True:
                # 发布位置数据
                position_batch = self.create_position_batch()
                position_msg = json.dumps(position_batch).encode('utf-8')
                self.position_socket.send_multipart([b"position", position_msg])
                
                # 发布门线指标数据
                gate_batch = self.create_gate_metrics_batch()
                gate_msg = json.dumps(gate_batch).encode('utf-8')
                self.gate_socket.send_multipart([b"gate", gate_msg])
                
                print(f"[{datetime.now().strftime('%H:%M:%S')}] "
                      f"发布位置数据({len(position_batch['positions'])}设备) + "
                      f"门线指标({len(gate_batch['metrics'])}指标)")
                
                time.sleep(0.1)  # 10 Hz
                
        except KeyboardInterrupt:
            print("\n收到中断信号，正在停止...")
        except Exception as e:
            print(f"发布错误: {e}")

def main():
    publisher = TestDataPublisher()
    
    try:
        publisher.start_publishers()
        publisher.publish_data()
    finally:
        publisher.stop_publishers()

if __name__ == "__main__":
    main()