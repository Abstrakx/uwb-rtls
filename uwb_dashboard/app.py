from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import time, socket

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

last_tag_time = 0
tag_ip = None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/uwb/update', methods=['POST'])
def uwb_update():
    global tag_ip, last_tag_time

    try:
        data = request.get_json(force=True)
        print("[UWB UPDATE]", data)

        anchors_data = {}

        if "anchors" in data:
            for anchor in data["anchors"]:
                anchor_name = f"A{anchor['A']}"  
                anchors_data[anchor_name] = {
                    "range": float(anchor["R"]),
                    "rssi": float(anchor["P"])
                }

        pos_data = {"x": 2.5, "y": 2.5, "z": 1.0}

        tag_ip = request.remote_addr
        last_tag_time = time.time()

        socketio.emit('uwb_update', {"pos": pos_data, "anchors": anchors_data})
        return jsonify({"status": "ok"}), 200

    except Exception as e:
        print("Error:", e)
        return jsonify({"error": str(e)}), 400

def tag_status_monitor():
    global last_tag_time, tag_ip
    while True:
        now = time.time()
        active = (now - last_tag_time) < 3  
        socketio.emit('tag_status', {
            "active": active,
            "server_ip": get_local_ip(),
            "tag_ip": tag_ip or "N/A"
        })
        socketio.sleep(1)

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


@socketio.on('connect')
def handle_connect():
    print("Client connected")

if __name__ == '__main__':
    socketio.start_background_task(tag_status_monitor)
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
