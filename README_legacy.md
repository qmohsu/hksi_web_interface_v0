# 定位与门线指标监控系统

这是一个基于Flask的Web服务器，用于接收ZMQ数据并提供实时前端展示。

## 功能特性

- 从ZMQ端口5000接收位置数据（PositionBatch格式）
- 从ZMQ端口5001接收门线指标数据（GateMetricsBatch格式）
- 实时WebSocket推送数据到前端
- 设备ID自动映射（标签T0-T99，锚点A0-A99）
- 响应式Web界面展示所有数据

## 数据格式

### 位置数据 (端口5000)
```json
{
    "timestamp_us": 1234567890123456,
    "positions": [
        {
            "device_id": 1,
            "lat": 22.3001,
            "lon": 114.2001,
            "alt_m": 0.5,
            "source_mask": 1
        }
    ]
}
```

### 门线指标数据 (端口5001)
```json
{
    "timestamp_us": 1234567890123456,
    "metrics": [
        {
            "tag_id": "T0",
            "gate_id": "start_line",
            "d_perp_m": -5.2,
            "s_along": 0.45,
            "time_to_line_s": 1.04,
            "crossing_event": "NO_CROSSING",
            "confidence": 0.0
        }
    ]
}
```

## 设备ID映射

| 设备类型 | ID范围 | 示例 |
|---------|--------|------|
| 标签 (Tags) | 1-99 | T0→1, T1→2, T2→3 |
| 锚点 (Anchors) | 101-199 | A0→101, A1→102, A2→103 |

## 安装依赖

```bash
pip install -r requirements.txt
```

## 启动服务器

```bash
# 启动Flask服务器（监听端口8080）
python app.py

# 或使用启动脚本
./start_server.sh
```

## 测试数据发布

可以使用测试发布器生成符合格式的测试数据：

```bash
# 在另一个终端中运行（推荐使用新的测试程序）
python test_data_publisher.py

# 或者使用旧的测试程序
python test_publisher.py both
```

## 访问前端

打开浏览器访问：http://localhost:8080

## API端点

- `GET /` - 主页面
- `GET /api/data` - 获取当前所有数据
- `GET /api/health` - 健康检查

## WebSocket事件

- `position_update` - 位置数据更新
- `gate_metrics_update` - 门线指标更新

## 系统架构

```
ZMQ Publisher (5000) → Flask Server → WebSocket → Web Frontend
ZMQ Publisher (5001) → Flask Server → WebSocket → Web Frontend
```

## 依赖项

- Python 3.7+
- Flask
- Flask-SocketIO
- eventlet
- pyzmq