const socket = io();
let anchors = []; 
let placeholderRemoved = false;
let isTagConnected = false;
let currentAnchors = {};
let anchorFormInitialized = false;
let lastAnchorKeySet = [];
let rssiPoints = { A1: [], A2: [], A3: [], A4: [] };

let lastValidData = null;
let lastUpdate = 0;
const STALE_THRESHOLD = 500; 

let lastTagStatus = null;
let lastTagUpdateTime = 0;
const TAG_UPDATE_THRESHOLD = 300; 

function updateRSSIChart(anchors) {
  const t = new Date().toLocaleTimeString();

  Object.keys(rssiPoints).forEach(a => {
    if (!anchors[a]) delete rssiPoints[a];
  });

  Object.keys(anchors).forEach(a => {
    const rssi = anchors[a].rssi;
    if (rssi == null) return;

    if (!rssiPoints[a]) rssiPoints[a] = [];

    rssiPoints[a].push({time: t, value: rssi});
    if (rssiPoints[a].length > 50) rssiPoints[a].shift();
  });

  drawRSSIChart();
}

function drawRSSIChart() {
  const traces = Object.keys(rssiPoints)
    .filter(a => rssiPoints[a].length > 0)
    .map(a => ({
      x: rssiPoints[a].map(p => p.time),
      y: rssiPoints[a].map(p => p.value),
      mode: 'lines',
      name: a
    }));

  Plotly.newPlot('rssi-chart', traces, {
    margin: {l: 30, r: 10, b: 30, t: 10},
    paper_bgcolor: "#111827",
    plot_bgcolor: "#111827",
  }, { displayModeBar: false });
}

function renderRSSIPlaceholder() {
  Plotly.newPlot('rssi-chart', [{
    x: [],
    y: [],
    mode: "lines",
    name: "RSSI",
  }], {
    margin: {l: 30, r: 10, b: 30, t: 10},
    paper_bgcolor: "#111827",
    plot_bgcolor: "#111827",
    xaxis: {
      color: "#aaa",
      title: "Time",
      range: [0, 10]
    },
    yaxis: {
      color: "#aaa",
      title: "RSSI (dBm)",
      range: [-50, 0]
    },
    annotations: [
      {
        text: "⏳ Waiting for RSSI data...",
        x: 0.5,
        y: 0.5,
        xref: "paper",
        yref: "paper",
        showarrow: false,
        font: {color: "#888", size: 16}
      }
    ]
  }, {
    displayModeBar: false
  });
}

socket.on('tag_status', (data) => {

  const now = performance.now();

  if (now - lastTagUpdateTime < TAG_UPDATE_THRESHOLD) return;

  if (
    !lastTagStatus || 
    lastTagStatus.active !== data.active ||
    lastTagStatus.tag_ip !== data.tag_ip ||
    lastTagStatus.server_ip !== data.server_ip
  ) {

    const tagDiv = document.getElementById("tag-status");
    const serverDiv = document.getElementById("server-ip");

    if (data.active) {
      tagDiv.innerHTML = `<span class="pulse-glow">🟢</span> Tag Connected <span class="text-sm text-gray-400">(${data.tag_ip})</span>`;
    } else {
      tagDiv.innerHTML = `<span class="pulse-glow">🔴</span> Tag Disconnected`;
    }

    serverDiv.innerHTML = `<span>💻</span> Server: ${data.server_ip}`;
  }

  lastTagStatus = data;
  lastTagUpdateTime = now;
  isTagConnected = data.active;
});

socket.on('uwb_update', (data) => {

  if (!data || !data.anchors) return;

  const keys = Object.keys(data.anchors);

  const sortedKeys = keys.slice().sort().join(",");

  if (!anchorFormInitialized || sortedKeys !== lastAnchorKeySet) {
      buildAnchorForm(keys);
      anchorFormInitialized = true;
      lastAnchorKeySet = sortedKeys;
  }

});

socket.on('uwb_update', (data) => {

  const valid =
    data &&
    typeof data === "object" &&
    data.pos &&
    data.anchors &&
    Object.keys(data.anchors).length > 0;

  if (valid) {
    lastValidData = data;
    lastUpdate = Date.now();
  }

  const now = Date.now();
  const isStale = (!lastValidData) || ((now - lastUpdate) > STALE_THRESHOLD);

  if (isStale) {
    console.log("[UWB DATA] ❌ stale/offline – placeholder mode");

    renderPlotPlaceholder();     
    updateAnchorsUI({});         
    updateTagUI({x: 0, y: 0, z: 0});

    renderRSSIPlaceholder() 

    return;
  }

  console.log("[UWB DATA]", lastValidData);

  const pos = lastValidData.pos;
  const anchors = data.anchors || {};
  const anchorsData = lastValidData.anchors;

  updateTagUI(pos);
  updateAnchorsUI(anchorsData);

  updateRSSIChart(anchorsData);
  renderPlot(pos);
});

// 3D offline scene
function renderPlotPlaceholder() {
  const fixedAnchors = [
    {name: 'A1', x: 0, y: 0, z: 0},
    {name: 'A2', x: 5, y: 0, z: 0},
    {name: 'A3', x: 0, y: 5, z: 0},
    {name: 'A4', x: 5, y: 5, z: 0}
  ];

  const anchorTrace = {
    x: fixedAnchors.map(a => a.x),
    y: fixedAnchors.map(a => a.y),
    z: fixedAnchors.map(a => a.z),
    mode: 'markers+text',
    type: 'scatter3d',
    text: fixedAnchors.map(a => a.name),
    marker: { size: 8, color: '#3B82F6' }
  };

  const tagTrace = {
    x: [2.5],
    y: [2.5],
    z: [0.5],
    mode: 'markers+text',
    type: 'scatter3d',
    text: ['Tag Offline'],
    marker: { size: 12, color: '#EF4444' }
  };

  Plotly.react("plot-area", [anchorTrace, tagTrace], window.plotLayout);
}

// 3D normal scene
function renderPlot(pos) {
  const fixedAnchors = [
    {name: 'A1', x: 0, y: 0, z: 0},
    {name: 'A2', x: 5, y: 0, z: 0},
    {name: 'A3', x: 0, y: 5, z: 0},
    {name: 'A4', x: 5, y: 5, z: 0}
  ];

  const anchorTrace = {
    x: fixedAnchors.map(a => a.x),
    y: fixedAnchors.map(a => a.y),
    z: fixedAnchors.map(a => a.z),
    mode: 'markers+text',
    type: 'scatter3d',
    text: fixedAnchors.map(a => a.name),
    marker: { size: 8, color: '#3B82F6' }
  };

  const tagTrace = {
    x: [pos.x],
    y: [pos.y],
    z: [pos.z],
    mode: 'markers+text',
    type: 'scatter3d',
    text: ['Tag'],
    marker: { size: 12, color: '#22C55E' }
  };

  Plotly.react("plot-area", [anchorTrace, tagTrace], window.plotLayout);
} 

// Tag position info
function updateTagUI(pos) {
  document.getElementById("pos").textContent =
    `X: ${pos.x.toFixed(2)} m, Y: ${pos.y.toFixed(2)} m, Z: ${pos.z.toFixed(2)} m`;
}

// Anchor UI cards
function updateAnchorsUI(anchorsData) {
  const anchorsDiv = document.getElementById("anchors");
  anchorsDiv.innerHTML = "";

  const keys = Object.keys(anchorsData);
  document.getElementById("anchor-count").textContent = keys.length;

  if (keys.length === 0) {
    anchorsDiv.innerHTML = `
      <div class="text-gray-500 text-center italic py-8 bg-gray-800/30 rounded-xl border border-dashed border-gray-700">
        ⏳ Waiting for anchor data...
      </div>`;
    
    document.getElementById('signal-quality').textContent = "-";
    return;
  }
  
  if (!isTagConnected) {
    document.getElementById('signal-quality').textContent = "-";
    return;
  }

  const avgRssi = Object.values(anchorsData)
    .reduce((sum, a) => sum + (a.rssi || 0), 0) / keys.length;
  
  const quality =
    avgRssi > -70 ? "🟢" :
    avgRssi > -85 ? "🟡" :
    "🔴";
  
  document.getElementById('signal-quality').textContent = quality;
  
  for (const [key, val] of Object.entries(anchorsData)) {
    const rssi = val.rssi ?? 0;
    const color = rssi > -70 ? "text-green-400" : rssi > -85 ? "text-yellow-400" : "text-red-400";

    const div = document.createElement("div");
    div.className =
      "bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 border border-gray-700/50";
    div.innerHTML = `
      <div class="flex justify-between mb-2">
        <div class="text-xl text-white">⚓ ${key}</div>
        <div class="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full">ACTIVE</div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="text-xs text-gray-400">Range</div>
          <div class="text-lg text-blue-400">${val.range ?? "-"} m</div>
        </div>
        <div>
          <div class="text-xs text-gray-400">RSSI</div>
          <div class="text-lg ${color}">${rssi} dBm</div>
        </div>
      </div>
    `;
    anchorsDiv.appendChild(div);
  }
}

socket.on("anchor_update", (saved) => {
  currentAnchors = saved;
  buildAnchorForm(Object.keys(saved));
});

function buildAnchorForm(anchorKeys) {
  const form = document.getElementById("anchor-form");
  form.innerHTML = "";

  anchorKeys.forEach((key) => {
    
    if (!currentAnchors[key]) {
      currentAnchors[key] = { x: 0, y: 0, z: 0 };
    }

    const a = currentAnchors[key] || { x: 0, y: 0, z: 0 };

    const block = document.createElement("div");
    block.className = "bg-gray-800/40 p-3 rounded-xl border border-gray-700/50";

    block.innerHTML = `
      <div class="font-semibold text-lg mb-2 text-blue-300">⚓ ${key}</div>
      
      <div class="grid grid-cols-2 gap-2">

        <div>
          <label class="text-xs text-gray-400">X (m)</label>
          <input type="number" step="0.01" id="${key}-x"
            value="${a.x}"
            class="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded-lg text-blue-300">
        </div>

        <div>
          <label class="text-xs text-gray-400">Y (m)</label>
          <input type="number" step="0.01" id="${key}-y"
            value="${a.y}"
            class="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded-lg text-blue-300">
        </div>
        
        <div>
          <label class="text-xs text-gray-400">Z (m)</label>
          <input type="number" step="0.01" id="${key}-z"
            value="${a.z}"
            class="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded-lg text-blue-300">
        </div>


      </div>
    `;

    form.appendChild(block);
  });
}

function startRecording() {
  const interval = parseFloat(document.getElementById("record-interval").value);

  fetch('/rtls/set_interval', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ interval })
  });

  fetch('/rtls/start', { method: 'POST' })
    .then(() => {
      document.querySelector("#status-label").innerText = "Recording...";
      document.querySelector("#status-label").classList.remove("text-red-400");
      document.querySelector("#status-label").classList.add("text-green-400");

      Swal.fire({
        icon: "success",
        title: "Recording Started",
        text: "RSSI data recording sudah dimulai."
      });
    })
    .catch(err => {
      Swal.fire({
        icon: "error",
        title: "Failed to Start",
        text: err.toString()
      });
    });
}

function stopRecording() {
  fetch('/rtls/stop', { method: 'POST' })
    .then(() => {
      document.querySelector("#status-label").innerText = "Stopped";
      document.querySelector("#status-label").classList.remove("text-green-400");
      document.querySelector("#status-label").classList.add("text-red-400");

      renderRSSIPlaceholder();

      Swal.fire({
        icon: "info",
        title: "Recording Stopped",
        text: "RSSI recording dihentikan dan chart dibersihkan."
      });
    })
    .catch(err => {
      Swal.fire({
        icon: "error",
        title: "Failed to Stop",
        text: err.toString()
      });
    });
}


async function saveAnchors() {
  const fields = document.querySelectorAll("[id$='-x']");
  let payload = {};
  
  fields.forEach((input) => {
    const key = input.id.replace("-x", "");
    payload[key] = {
      x: parseFloat(document.getElementById(`${key}-x`).value),
      y: parseFloat(document.getElementById(`${key}-y`).value),
      z: parseFloat(document.getElementById(`${key}-z`).value)
    };
  });

  const result = await fetch("/set_anchors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const res = await result.json();
  const statusDiv = document.getElementById("anchor-save-status");

  if (res.status === "ok") {
    statusDiv.textContent = "Saved ✔️";
    statusDiv.classList.remove("text-red-400");
    statusDiv.classList.add("text-green-400");
  } else {
    statusDiv.textContent = "Failed ❌";
    statusDiv.classList.add("text-red-400");
  }
}

document.getElementById('resetDbButton').addEventListener('click', function() {
  Swal.fire({
      title: 'Yakin mau Reset Database?',
      text: "Semua data rekaman RTLS akan dihapus permanen!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Ya, Hapus Data!',
      cancelButtonText: 'Batal'
  }).then((result) => {
      if (result.isConfirmed) {
          fetch('/rtls/reset', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              }
          })
          .then(response => response.json())
          .then(data => {
              if (data.status === 'reset_success') {
                  Swal.fire(
                      'Dihapus!',
                      'Database rekaman RTLS telah direset.',
                      'success'
                  );
              } else {
                  Swal.fire(
                      'Gagal!',
                      'Gagal mereset database. Cek log server.',
                      'error'
                  );
              }
          })
          .catch(error => {
              console.error('Error:', error);
              Swal.fire(
                  'Error Jaringan!',
                  'Tidak dapat menghubungi server Flask.',
                  'error'
              );
          });
      }
  });
});