#!/bin/bash
# 启动Flask服务器的脚本

# 检查是否安装了Python依赖
if ! python3 -c "import flask, flask_socketio, zmq" &> /dev/null; then
    echo "正在安装依赖..."
    pip3 install -r requirements.txt
fi

echo "启动Flask服务器..."
python3 app.py