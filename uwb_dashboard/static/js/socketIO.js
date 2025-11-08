const socket = io();
let anchors = []; 
let placeholderRemoved = false;

// Status Tag UWB
socket.on('tag_status', (data) => {
  const tagDiv = document.getElementById("tag-status");
  const serverDiv = document.getElementById("server-ip");

  if (data.active) {
    tagDiv.innerHTML = `<span class="pulse-glow">🟢</span> Tag Connected <span class="text-sm text-gray-400">(${data.tag_ip})</span>`;
  } else {
    tagDiv.innerHTML = `<span class="pulse-glow">🔴</span> Tag Disconnected`;
  }

  serverDiv.innerHTML = `<span>💻</span> Server: ${data.server_ip}`;
});

// terima data UWB baru dari Flask
socket.on('uwb_update', (data) => {
  const plotArea = document.getElementById("plot-area");

  // 🧩 Define anchors (static scene)
  const fixedAnchors = [
    {name: 'A1', x: 0, y: 0, z: 0},
    {name: 'A2', x: 5, y: 0, z: 0},
    {name: 'A3', x: 0, y: 5, z: 0},
    {name: 'A4', x: 5, y: 5, z: 0}
  ];

  // 🟨 If no data or tag disconnected, show placeholder
  if (!data || Object.keys(data).length === 0) {
    console.log('[UWB DATA] No data — showing placeholder scene.');

    const anchorTrace = {
      x: fixedAnchors.map(a => a.x),
      y: fixedAnchors.map(a => a.y),
      z: fixedAnchors.map(a => a.z),
      mode: 'markers+text',
      type: 'scatter3d',
      text: fixedAnchors.map(a => a.name),
      textposition: 'top center',
      marker: { size: 8, color: '#3B82F6', symbol: 'circle' },
      name: 'Anchors'
    };

    const tagTrace = {
      x: [0],
      y: [0],
      z: [0],
      mode: 'markers+text',
      type: 'scatter3d',
      text: ['Tag (Offline)'],
      textposition: 'bottom center',
      marker: { size: 12, color: '#EF4444', symbol: 'diamond' },
      name: 'Tag (Offline)'
    };

    const layout = {
      margin: {l: 0, r: 0, b: 0, t: 0},
      scene: {
        xaxis: {title: 'X (m)', backgroundcolor: "#0f172a", gridcolor: "#1e293b"},
        yaxis: {title: 'Y (m)', backgroundcolor: "#0f172a", gridcolor: "#1e293b"},
        zaxis: {title: 'Z (m)', backgroundcolor: "#0f172a", gridcolor: "#1e293b"},
        aspectmode: 'cube',
        camera: {eye: {x: 1.5, y: 1.5, z: 1.3}}
      },
      paper_bgcolor: '#0f172a',
      plot_bgcolor: '#0f172a',
      font: {color: '#94a3b8'}
    };

    if (!window.plotInitialized) {
      Plotly.newPlot('plot-area', [anchorTrace, tagTrace], layout, {displayModeBar: false});
      window.plotInitialized = true;
    } else {
      Plotly.react('plot-area', [anchorTrace, tagTrace], layout);
    }

    // Update anchor count
    document.getElementById('anchor-count').textContent = '0';
    document.getElementById('signal-quality').textContent = '-';
    
    // Show waiting message
    const anchorsDiv = document.getElementById("anchors");
    anchorsDiv.innerHTML = `
      <div class="text-gray-500 text-center italic py-8 bg-gray-800/30 rounded-xl border border-dashed border-gray-700">
        ⏳ Waiting for anchor data...
      </div>`;
    
    return;
  }

  // 🟩 If data exists, normal update
  console.log('[UWB DATA]', data);

  // === Update posisi tag ===
  const pos = data.pos || {x: 0, y: 0, z: 0};
  document.getElementById("pos").textContent = 
    `X: ${pos.x.toFixed(2)} m, Y: ${pos.y.toFixed(2)} m, Z: ${pos.z.toFixed(2)} m`;

  // === Update daftar anchor ===
  const anchorsDiv = document.getElementById("anchors");
  const anchorsData = data.anchors || {};
  const keys = Object.keys(anchorsData);
  const waitingDiv = anchorsDiv.querySelector('.waiting-placeholder');

  // Update anchor count
  document.getElementById('anchor-count').textContent = keys.length;

  // Calculate average RSSI for signal quality
  if (keys.length > 0) {
    const avgRssi = Object.values(anchorsData).reduce((sum, a) => sum + (a.rssi || 0), 0) / keys.length;
    const quality = avgRssi > -70 ? '🟢' : avgRssi > -85 ? '🟡' : '🔴';
    document.getElementById('signal-quality').textContent = quality;
  } else {
    document.getElementById('signal-quality').textContent = '-';
  }

  // ✅ Render anchor cards tanpa duplikasi
  if (keys.length === 0) {
    if (!waitingDiv) {
      anchorsDiv.innerHTML = `
        <div class="waiting-placeholder text-gray-500 text-center italic py-8 
                    bg-gray-800/30 rounded-xl border border-dashed border-gray-700">
          ⏳ Waiting for anchor data...
        </div>`;
    }
  } else {
    if (waitingDiv) waitingDiv.remove();
    
    const existingKeys = new Set([...anchorsDiv.querySelectorAll('[data-key]')].map(el => el.dataset.key));
  
    for (const [key, val] of Object.entries(anchorsData)) {
      const rssi = val.rssi || 0;
      const signalColor = rssi > -70 ? 'text-green-400' : rssi > -85 ? 'text-yellow-400' : 'text-red-400';
      const signalIcon = rssi > -70 ? '📶' : rssi > -85 ? '📡' : '📉';
  
      // 🔍 Cek apakah card sudah ada
      let div = anchorsDiv.querySelector(`[data-key="${key}"]`);
  
      if (!div) {
        // 🆕 Buat card baru jika belum ada
        div = document.createElement('div');
        div.dataset.key = key;
        div.className =
          "bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 border border-gray-700/50 hover:border-blue-500/50 transition-all duration-300 slide-in";
        anchorsDiv.appendChild(div);
      }
  
      // ✏️ Update isi card (selalu refresh data terbaru)
      div.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <div>
            <div class="text-xl font-bold text-white flex items-center gap-2">
              <span class="text-2xl">⚓</span> ${key}
            </div>
          </div>
          <div class="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full font-semibold">
            ACTIVE
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-3">
          <div class="bg-gray-700/50 rounded-lg p-2">
            <div class="text-xs text-gray-400">Range</div>
            <div class="text-lg font-bold text-blue-400">${val.range ?? '-'} m</div>
          </div>
          <div class="bg-gray-700/50 rounded-lg p-2">
            <div class="text-xs text-gray-400 flex items-center gap-1">
              <span>${signalIcon}</span> RSSI
            </div>
            <div class="text-lg font-bold ${signalColor}">${val.rssi ?? '-'} dBm</div>
          </div>
        </div>
      `;
  
      existingKeys.delete(key); // tandai anchor ini masih aktif
    }
  
    // 🗑️ Hapus card lama yang sudah tidak ada di data
    for (const oldKey of existingKeys) {
      const oldDiv = anchorsDiv.querySelector(`[data-key="${oldKey}"]`);
      if (oldDiv) oldDiv.remove();
    }
  }

  // === Update visualisasi 3D ===
  const tag = {x: pos.x, y: pos.y, z: pos.z};

  const anchorTrace = {
    x: fixedAnchors.map(a => a.x),
    y: fixedAnchors.map(a => a.y),
    z: fixedAnchors.map(a => a.z),
    mode: 'markers+text',
    type: 'scatter3d',
    text: fixedAnchors.map(a => a.name),
    textposition: 'top center',
    marker: {size: 8, color: '#3B82F6', symbol: 'circle', line: {color: '#60A5FA', width: 2}},
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
    marker: {size: 12, color: '#22C55E', symbol: 'diamond', line: {color: '#4ADE80', width: 2}},
    name: 'Tag'
  };

  const layout = {
    margin: {l: 0, r: 0, b: 0, t: 0},
    scene: {
      xaxis: {title: 'X (m)', backgroundcolor: "#0f172a", gridcolor: "#1e293b"},
      yaxis: {title: 'Y (m)', backgroundcolor: "#0f172a", gridcolor: "#1e293b"},
      zaxis: {title: 'Z (m)', backgroundcolor: "#0f172a", gridcolor: "#1e293b"},
      aspectmode: 'cube',
      camera: {eye: {x: 1.5, y: 1.5, z: 1.3}}
    },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: {color: '#94a3b8'}
  };

  if (!window.plotInitialized) {
    Plotly.newPlot('plot-area', [anchorTrace, tagTrace], layout, {displayModeBar: false});
    window.plotInitialized = true;
  } else {
    Plotly.react('plot-area', [anchorTrace, tagTrace], layout);
  }
});