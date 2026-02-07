#!/usr/bin/env python3
"""
Flask服务器用于接收ZMQ数据并提供前端展示

该服务器：
1. 从ZMQ SUB socket (端口5000) 接收位置数据
2. 从ZMQ SUB socket (端口5001) 接收门线指标数据  
3. 通过WebSocket向前端实时推送数据
4. 提供HTML前端页面进行可视化展示
"""

import json
import threading
import time
import logging
from datetime import datetime
from collections import defaultdict, deque
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Any

import zmq
from zmq import Again
from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO, emit
import eventlet

# 使用eventlet作为WSGI服务器
eventlet.monkey_patch()

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 全局数据存储
class GlobalDataStore:
    def __init__(self):
        self.positions = {}  # device_id -> position data
        self.gate_metrics = []  # list of gate metrics
        self.last_position_update = 0
        self.last_gate_update = 0
        self.position_history = defaultdict(lambda: deque(maxlen=100))  # 保留最近100个位置点
        
    def update_positions(self, positions_data: List[Dict]):
        """更新位置数据"""
        current_time = time.time()
        self.last_position_update = current_time
        
        for pos in positions_data:
            device_id = pos['device_id']
            self.positions[device_id] = pos
            # 保存历史记录
            self.position_history[device_id].append({
                'timestamp': current_time,
                'lat': pos['lat'],
                'lon': pos['lon'],
                'alt_m': pos['alt_m']
            })
    
    def update_gate_metrics(self, metrics_data: List[Dict]):
        """更新门线指标数据"""
        self.last_gate_update = time.time()
        self.gate_metrics = metrics_data
    
    def get_device_info(self, device_id: int) -> Dict[str, Any]:
        """获取设备信息（类型、名称等）"""
        if 1 <= device_id <= 99:
            # 标签 (Tags)
            tag_name = f"T{device_id - 1}"
            device_type = "tag"
        elif 101 <= device_id <= 199:
            # 锚点 (Anchors)
            anchor_name = f"A{device_id - 101}"
            device_type = "anchor"
        else:
            tag_name = f"Unknown_{device_id}"
            device_type = "unknown"
            
        return {
            'device_id': device_id,
            'name': tag_name if device_type == 'tag' else anchor_name if device_type == 'anchor' else tag_name,
            'type': device_type
        }
    
    def get_all_data(self) -> Dict[str, Any]:
        """获取所有数据用于前端展示"""
        tags = []
        anchors = []
        
        for device_id, pos_data in self.positions.items():
            device_info = self.get_device_info(device_id)
            if device_info['type'] == 'tag':
                tags.append({
                    'info': device_info,
                    'position': pos_data
                })
            elif device_info['type'] == 'anchor':
                anchors.append({
                    'info': device_info,
                    'position': pos_data
                })
        
        return {
            'tags': tags,
            'anchors': anchors,
            'gate_metrics': self.gate_metrics,
            'last_position_update': self.last_position_update,
            'last_gate_update': self.last_gate_update,
            'timestamp': time.time()
        }

# 初始化全局数据存储
data_store = GlobalDataStore()

# 创建Flask应用
app = Flask(__name__)
app.config['SECRET_KEY'] = 'relay_tracking_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*")

@app.route('/')
def index():
    """主页面"""
    return render_template('index.html')

@app.route('/api/data')
def get_data():
    """API端点：获取当前所有数据"""
    return jsonify(data_store.get_all_data())

@app.route('/api/health')
def health_check():
    """健康检查端点"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'positions_count': len(data_store.positions),
        'gate_metrics_count': len(data_store.gate_metrics)
    })

def zmq_position_listener():
    """ZMQ监听器：接收位置数据（端口5000）"""
    context = zmq.Context()
    socket = context.socket(zmq.SUB)
    socket.connect("tcp://localhost:5000")
    socket.setsockopt_string(zmq.SUBSCRIBE, "position")
    # 设置接收超时为1秒，避免无限期阻塞
    socket.setsockopt(zmq.RCVTIMEO, 1000)
    
    logger.info("ZMQ位置监听器已启动，连接到 tcp://localhost:5000")
    
    while True:
        try:
            topic, message = socket.recv_multipart(flags=zmq.NOBLOCK)
            topic = topic.decode('utf-8')
            
            if topic == "position":
                # 解析JSON消息
                data = json.loads(message.decode('utf-8'))
                positions = data.get('positions', [])
                
                # 更新数据存储
                data_store.update_positions(positions)
                
                # 通过WebSocket广播更新
                socketio.emit('position_update', {
                    'positions': positions,
                    'timestamp': data.get('timestamp_us', 0)
                })
                
                logger.debug(f"接收到位置数据，设备数量: {len(positions)}")
                
        except zmq.Again:
            # 没有消息可用，短暂休眠后继续
            time.sleep(0.1)
            continue
        except Exception as e:
            logger.error(f"ZMQ位置监听器错误: {e}")
            time.sleep(1)

def zmq_gate_metrics_listener():
    """ZMQ监听器：接收门线指标数据（端口5001）"""
    context = zmq.Context()
    socket = context.socket(zmq.SUB)
    socket.connect("tcp://localhost:5001")
    socket.setsockopt_string(zmq.SUBSCRIBE, "gate")
    # 设置接收超时为1秒，避免无限期阻塞
    socket.setsockopt(zmq.RCVTIMEO, 1000)
    
    logger.info("ZMQ门线指标监听器已启动，连接到 tcp://localhost:5001")
    
    while True:
        try:
            topic, message = socket.recv_multipart(flags=zmq.NOBLOCK)
            topic = topic.decode('utf-8')
            
            if topic == "gate":
                # 解析JSON消息
                data = json.loads(message.decode('utf-8'))
                metrics = data.get('metrics', [])
                
                # 更新数据存储
                data_store.update_gate_metrics(metrics)
                
                # 通过WebSocket广播更新
                socketio.emit('gate_metrics_update', {
                    'metrics': metrics,
                    'timestamp': data.get('server_timestamp_us', 0)
                })
                
                logger.debug(f"接收到门线指标数据，指标数量: {len(metrics)}")
                
        except zmq.Again:
            # 没有消息可用，短暂休眠后继续
            time.sleep(0.1)
            continue
        except Exception as e:
            logger.error(f"ZMQ门线指标监听器错误: {e}")
            time.sleep(1)

def start_zmq_listeners():
    """启动ZMQ监听器线程"""
    logger.info("准备启动ZMQ监听器线程...")
    
    position_thread = threading.Thread(target=zmq_position_listener, daemon=True)
    gate_thread = threading.Thread(target=zmq_gate_metrics_listener, daemon=True)
    
    position_thread.start()
    logger.info("位置监听器线程已启动")
    
    gate_thread.start()
    logger.info("门线指标监听器线程已启动")
    
    logger.info("ZMQ监听器线程已启动")

if __name__ == '__main__':
    # 创建templates目录（如果不存在）
    import os
    if not os.path.exists('templates'):
        os.makedirs('templates')
    
    # 启动ZMQ监听器
    start_zmq_listeners()
    
    # 启动Flask应用
    logger.info("启动Flask服务器...")
    socketio.run(app, host='0.0.0.0', port=8080, debug=False)