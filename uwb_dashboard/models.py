from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class RTLSRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    x = db.Column(db.Float)
    y = db.Column(db.Float)

    a2_range = db.Column(db.Float)
    a3_range = db.Column(db.Float)
    a4_range = db.Column(db.Float)

    a2_rssi = db.Column(db.Float)
    a3_rssi = db.Column(db.Float)
    a4_rssi = db.Column(db.Float)

    def to_dict(self):
        return {
            "timestamp": self.timestamp.isoformat(),
            "x": self.x, "y": self.y, "z": self.z,
            "a2_range": self.a2_range,
            "a3_range": self.a3_range,
            "a4_range": self.a4_range,
            "a2_rssi": self.a2_rssi,
            "a3_rssi": self.a3_rssi,
            "a4_rssi": self.a4_rssi,
        }