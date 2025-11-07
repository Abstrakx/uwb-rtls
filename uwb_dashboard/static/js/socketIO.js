const socket = io();
let anchors = []; 

// Status Tag UWB
socket.on('tag_status', (data) => {
  const tagDiv = document.getElementById("tag-status");
  const serverDiv = document.getElementById("server-ip");

  if (data.active) {
    tagDiv.textContent = `🟢 Tag Connected (${data.tag_ip})`;
  } else {
    tagDiv.textContent = `🔴 Tag Disconnected`;
  }

  serverDiv.textContent = `💻 Server: ${data.server_ip}`;
});

// terima data UWB baru dari Flask
socket.on('uwb_update', (data) => {
  console.log('[UWB DATA]', data);

  // === Update posisi tag ===
  const pos = data.pos || {x: 0, y: 0, z: 0};
  document.getElementById("pos").textContent = 
    `X: ${pos.x.toFixed(2)} m, Y: ${pos.y.toFixed(2)} m, Z: ${pos.z.toFixed(2)} m`;

  // === Update daftar anchor ===
  const anchorsDiv = document.getElementById("anchors");
  anchorsDiv.innerHTML = '';

  const anchorsData = data.anchors || {};

  const keys = Object.keys(anchorsData);
  if (keys.length === 0) {
    anchorsDiv.innerHTML = `
      <div class="text-gray-400 text-center italic py-3">
        ⏳ Waiting for anchor data...
      </div>`;
  } else {
    for (const [key, val] of Object.entries(anchorsData)) {
      const div = document.createElement('div');
      div.className = "bg-gray-700 rounded-lg p-3 flex justify-between items-center";
      div.innerHTML = `
        <div>
          <div class="text-lg font-semibold text-white">${key}</div>
          <div class="text-sm text-gray-400">Range: ${val.range ?? '-'} m</div>
        </div>
        <div class="text-blue-400 font-mono">${val.rssi ?? '-'} dBm</div>
      `;
      anchorsDiv.appendChild(div);
    }
  }

  // === Update visualisasi 3D ===
  const fixedAnchors = [
    {name: 'A1', x: 0, y: 0, z: 0},
    {name: 'A2', x: 5, y: 0, z: 0},
    {name: 'A3', x: 0, y: 5, z: 0},
    {name: 'A4', x: 5, y: 5, z: 0}
  ];

  const tag = {x: pos.x, y: pos.y, z: pos.z};

  const anchorTrace = {
    x: fixedAnchors.map(a => a.x),
    y: fixedAnchors.map(a => a.y),
    z: fixedAnchors.map(a => a.z),
    mode: 'markers+text',
    type: 'scatter3d',
    text: fixedAnchors.map(a => a.name),
    textposition: 'top center',
    marker: {size: 6, color: '#3B82F6', symbol: 'circle'},
    name: 'Anchors'
  };

  const tagTrace = {
    x: [tag.x],
    y: [tag.y],
    z: [tag.z],
    mode: 'markers+text',
    type: 'scatter3d',
    text: ['Tag'],
    textposition: 'bottom center',
    marker: {size: 8, color: '#22C55E', symbol: 'diamond'},
    name: 'Tag'
  };

  const layout = {
    margin: {l: 0, r: 0, b: 0, t: 0},
    scene: {
      xaxis: {title: 'X (m)', backgroundcolor: "#111"},
      yaxis: {title: 'Y (m)', backgroundcolor: "#111"},
      zaxis: {title: 'Z (m)', backgroundcolor: "#111"},
      aspectmode: 'cube'
    },
    paper_bgcolor: '#111827',
    plot_bgcolor: '#111827'
  };

  Plotly.newPlot('plot-area', [anchorTrace, tagTrace], layout, {displayModeBar: false});
});