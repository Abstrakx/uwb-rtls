from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import time, socket, os, json, math
import numpy as np

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Tag Connection
last_tag_time = 0
tag_ip = None

# Anchor Position
ANCHOR_FILE = "anchors.json"
anchor_positions = {}   # { "A1": {"x":0,"y":0,"z":0}, ... }
last_ranges = {}         # { "A1": 2.5, "A2": 3.1, ... }

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

        if not active:
            socketio.emit('uwb_update', {}) 

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

# API: update anchor positions from frontend
@app.route('/set_anchors', methods=['POST'])
def set_anchors():
    global anchor_positions
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON"}), 400

    anchor_positions = data
    save_anchors()
    socketio.emit("anchor_update", anchor_positions)
    return jsonify({"status": "ok", "anchors": anchor_positions})

# Load anchor position on startup
def load_anchors():
    global anchor_positions
    if os.path.exists(ANCHOR_FILE):
        with open(ANCHOR_FILE, "r") as f:
            anchor_positions = json.load(f)
            print("📁 Loaded anchor positions:", anchor_positions)
    else:
        print("⚠️ No anchors.json found. Using empty anchor set.")
        anchor_positions = {}

def save_anchors():
    with open(ANCHOR_FILE, "w") as f:
        json.dump(anchor_positions, f, indent=2)
    print("💾 Anchors saved:", anchor_positions)

# Trilateration Algorithm (3D)
def trilaterate(anchors, ranges):
    if len(anchors) < 3:
        return {"x": 0, "y": 0, "z": 0}  # minimal 3 anchor

    ids = list(anchors.keys())[:3]
    P1 = np.array([anchors[ids[0]]['x'], anchors[ids[0]]['y'], anchors[ids[0]]['z']])
    P2 = np.array([anchors[ids[1]]['x'], anchors[ids[1]]['y'], anchors[ids[1]]['z']])
    P3 = np.array([anchors[ids[2]]['x'], anchors[ids[2]]['y'], anchors[ids[2]]['z']])

    r1, r2, r3 = ranges.get(ids[0], 0), ranges.get(ids[1], 0), ranges.get(ids[2], 0)

    ex = (P2 - P1) / np.linalg.norm(P2 - P1)
    i = np.dot(ex, P3 - P1)
    ey = (P3 - P1 - i * ex) / np.linalg.norm(P3 - P1 - i * ex)
    ez = np.cross(ex, ey)
    d = np.linalg.norm(P2 - P1)
    j = np.dot(ey, P3 - P1)

    x = (r1**2 - r2**2 + d**2) / (2 * d)
    y = (r1**2 - r3**2 + i**2 + j**2 - 2*i*x) / (2 * j)
    z2 = r1**2 - x**2 - y**2
    z = math.sqrt(abs(z2)) if z2 > 0 else 0

    result = P1 + x * ex + y * ey + z * ez
    return {"x": float(result[0]), "y": float(result[1]), "z": float(result[2])}

@socketio.on('connect')
def handle_connect():
    print("Client connected")

if __name__ == '__main__':
    socketio.start_background_task(tag_status_monitor)
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
