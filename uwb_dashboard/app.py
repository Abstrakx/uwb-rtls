from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from openpyxl import Workbook
from models import db, RTLSRecord
import time, socket, os, json
import numpy as np

app = Flask(__name__)
CORS(app)

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///rtls.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

socketio = SocketIO(app, cors_allowed_origins="*")

# Tag Connection
last_tag_time = 0
tag_ip = None

# Anchor Position
ANCHOR_FILE = "anchors.json"
anchor_positions = {}  
last_ranges = {}        

# Record Data Interval
last_record_time = 0
record_interval = 1.0

is_recording = False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/uwb/update', methods=['POST'])
def uwb_update():
    global tag_ip, last_tag_time, anchor_positions, last_record_time, record_interval, is_recording

    now = time.time()

    try:
        data = request.get_json(force=True)
        print("[UWB UPDATE]", data)

        anchors_data = {}
        anchors_slot = {
            "A1": None,
            "A2": None,
            "A3": None,
            "A4": None
        }

        if "anchors" in data:
            for anchor in data["anchors"]:
                anchor_name = f"A{anchor['A']}"  
                anchors_data[anchor_name] = {
                    "range": float(anchor["R"]),
                    "rssi": float(anchor["P"])
                }

        ranges = {
            k: max(0.1, abs(anchors_data[k]["range"]))  
            for k in anchors_data
        }

        usable = {k: anchor_positions[k] for k in ranges if k in anchor_positions}

        pos = None
        if len(usable) >= 3:
            pos = trilaterate_3d(usable, ranges)

        # normalize output trilaterate
        if isinstance(pos, (int, float, np.generic)):
            # scalar → bukan valid
            pos = None
        elif isinstance(pos, np.ndarray) and pos.ndim == 0:
            pos = None

        if pos is None or not hasattr(pos, "__len__") or len(pos) != 3:
            pos_data = {"x": 0, "y": 0, "z": 0}
        else:
            pos_data = {
                "x": float(pos[0]),
                "y": float(pos[1]),
                "z": float(pos[2]),
            }

        valid = (
            pos_data["x"] is not None and
            pos_data["y"] is not None and
            pos_data["z"] is not None 
        )
        
        for key in anchors_data:
            raw_id = key.replace("A", "")  
            last_digit = raw_id[-1]        

            slot_name = f"A{last_digit}"  
            anchors_slot[slot_name] = key  

        if is_recording and valid and (now - last_record_time >= record_interval):
            last_record_time = now

            a1_key = anchors_slot["A1"]
            a2_key = anchors_slot["A2"]
            a3_key = anchors_slot["A3"]
            a4_key = anchors_slot["A4"]

            record = RTLSRecord(
                x=float(pos_data.get("x", 0)), 
                y=float(pos_data.get("y", 0)), 
                z=float(pos_data.get("z", 0)), 

                a1_range=anchors_data.get(a1_key, {}).get("range"),
                a1_rssi=anchors_data.get(a1_key, {}).get("rssi"),

                a2_range=anchors_data.get(a2_key, {}).get("range"),
                a2_rssi=anchors_data.get(a2_key, {}).get("rssi"),

                a3_range=anchors_data.get(a3_key, {}).get("range"),
                a3_rssi=anchors_data.get(a3_key, {}).get("rssi"),

                a4_range=anchors_data.get(a4_key, {}).get("range"),
                a4_rssi=anchors_data.get(a4_key, {}).get("rssi"),
            )

            db.session.add(record)
            db.session.commit()
            print("SAVED")
        else:
            print("RTLS TIDAK VALID " + "valid:" + str(valid) + "   recoding:" + str(is_recording))

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
@app.route("/set_anchors", methods=["POST"])
def set_anchors():
    global anchor_positions
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid payload"}), 400
    anchor_positions.update(data)
    save_anchors()
    socketio.emit("anchor_update", anchor_positions)
    return jsonify({"status": "ok", "anchors": anchor_positions})

# Load anchor position on startup
def load_anchors():
    global anchor_positions
    if os.path.exists(ANCHOR_FILE):
        try:
            with open(ANCHOR_FILE, "r") as f:
                anchor_positions = json.load(f)
            print("📁 Loaded anchors:", anchor_positions)
        except Exception as e:
            print("⚠️ Failed to load anchors.json:", e)
            anchor_positions = {}
    else:
        print("⚠️ anchors.json not found — start empty")
        anchor_positions = {}

def save_anchors():
    global anchor_positions
    with open(ANCHOR_FILE, "w") as f:
        json.dump(anchor_positions, f, indent=2)
    print("💾 Anchors saved:", anchor_positions)

# Trilateration Algorithm (3D)
def trilaterate_3d(anchor_positions, ranges):
    keys = list(anchor_positions.keys())

    valid = [k for k in keys if k in ranges and ranges[k] >= 0]
    if len(valid) < 4:
        return None

    keys = valid[:4]  

    P1 = np.array((
        anchor_positions[keys[0]]["x"],
        anchor_positions[keys[0]]["y"],
        anchor_positions[keys[0]]["z"],
    ))
    r1 = ranges[keys[0]]

    A = []
    b = []

    for k in keys[1:]:
        Pi = np.array((
            anchor_positions[k]["x"],
            anchor_positions[k]["y"],
            anchor_positions[k]["z"],
        ))
        ri = ranges[k]

        A.append([
            2*(Pi[0] - P1[0]),
            2*(Pi[1] - P1[1]),
            2*(Pi[2] - P1[2])
        ])

        b.append(
            r1**2 - ri**2
            - (P1[0]**2 - Pi[0]**2)
            - (P1[1]**2 - Pi[1]**2)
            - (P1[2]**2 - Pi[2]**2)
        )

    A = np.array(A)
    b = np.array(b)

    pos, _, _, _ = np.linalg.lstsq(A, b, rcond=None)

    pos = np.array(pos).flatten()
    if pos.size != 3:
        return None

    return pos.tolist()

@app.route("/rtls/start", methods=["POST"])
def rtls_start():
    global is_recording
    is_recording = True
    return jsonify({"status": "recording_started"})

@app.route("/rtls/stop", methods=["POST"])
def rtls_stop():
    global is_recording
    is_recording = False
    return jsonify({"status": "recording_stopped"})

@app.route("/rtls/set_interval", methods=["POST"])
def set_interval():
    global record_interval
    record_interval = float(request.json.get("interval", 1))
    return jsonify({"status": "ok", "interval": record_interval})

@app.route("/rtls/download")
def download_excel():
    wb = Workbook()
    ws = wb.active

    ws.append([
            "timestamp", "x", "y", "z", 
            "A1_Range", "A2_Range", "A3_Range", "A4_Range",
            "A1_RSSI", "A2_RSSI", "A3_RSSI", "A4_RSSI"  
        ])

    rows = RTLSRecord.query.all()
    for r in rows:
        ws.append([
            r.timestamp, r.x, r.y, r.z, 
            r.a1_range, r.a2_range, r.a3_range, r.a4_range,
            r.a1_rssi, r.a2_rssi, r.a3_rssi, r.a4_rssi 
        ])

    filename = "recordings/rtls.xlsx"

    os.makedirs(os.path.dirname(filename), exist_ok=True) 
    wb.save(filename)

    return send_file(filename, as_attachment=True)

@app.route("/anchor/get", methods=["GET"])
def anchor_get():
    return jsonify(anchor_positions)

@socketio.on('connect')
def handle_connect():
    emit("anchor_update", anchor_positions)
    print("Client connected")

if __name__ == '__main__':
    load_anchors()
    socketio.start_background_task(tag_status_monitor)
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
