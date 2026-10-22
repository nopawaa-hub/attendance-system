const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { page } = require('../views/layout');

const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
}

function status(p) {
  const now = new Date();
  const start = new Date(`${p.date}T${p.start_time}`);
  const end = new Date(`${p.date}T${p.end_time}`);
  if (now < start) return { label: 'Upcoming', cls: 'bg-amber-100 text-amber-800' };
  if (now > end) return { label: 'Closed', cls: 'bg-slate-200 text-slate-600' };
  return { label: 'Open', cls: 'bg-emerald-100 text-emerald-800' };
}

// ---- auth ----
router.get('/login', (req, res) => {
  res.send(page({
    title: 'Admin Login',
    body: `
<div class="max-w-sm mx-auto mt-24 bg-white rounded-xl shadow p-8">
  <h1 class="text-2xl font-bold mb-6 text-slate-800">Admin Login</h1>
  ${req.query.err ? '<p class="mb-4 text-sm text-red-600 bg-red-50 rounded p-2">Wrong username or password.</p>' : ''}
  <form method="POST" class="space-y-4">
    <input name="username" placeholder="Username" class="w-full border rounded-lg px-3 py-2" required>
    <input name="password" type="password" placeholder="Password" class="w-full border rounded-lg px-3 py-2" required>
    <button class="w-full bg-indigo-600 text-white rounded-lg py-2 font-semibold hover:bg-indigo-700">Log in</button>
  </form>
</div>`
  }));
});

router.post('/login', (req, res) => {
  if (req.body.username === ADMIN_USER && req.body.password === ADMIN_PASS) {
    req.session.admin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?err=1');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---- dashboard ----
router.get('/', requireAuth, (req, res) => {
  const programmes = db.prepare(`
    SELECT p.*, COUNT(a.id) AS count FROM programmes p
    LEFT JOIN attendances a ON a.programme_id = p.id
    GROUP BY p.id ORDER BY p.date DESC, p.start_time DESC
  `).all();
  const rows = programmes.map(p => {
    const s = status(p);
    return `<tr class="border-b hover:bg-slate-50">
      <td class="px-4 py-3 font-medium text-slate-800">${p.name}</td>
      <td class="px-4 py-3">${p.date}</td>
      <td class="px-4 py-3">${p.start_time} – ${p.end_time}</td>
      <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-semibold status-badge" data-date="${p.date}" data-start="${p.start_time}" data-end="${p.end_time}">${s.label}</span></td>
      <td class="px-4 py-3 text-center font-semibold count-cell" data-id="${p.id}">${p.count}</td>
      <td class="px-4 py-3 space-x-2 whitespace-nowrap">
        <a href="/admin/programme/${p.id}" class="text-indigo-600 hover:underline">Attendance</a>
        <a href="/admin/programme/${p.id}/qr" class="text-indigo-600 hover:underline">QR</a>
        <form method="POST" action="/admin/programme/${p.id}/delete" class="inline" onsubmit="return confirm('Delete this programme and all its attendance?')">
          <button class="text-red-600 hover:underline">Delete</button>
        </form>
      </td>
    </tr>`;
  }).join('');
  res.send(page({
    title: 'Dashboard',
    body: `
<div class="max-w-6xl mx-auto p-6">
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-3xl font-bold text-slate-800">Attendance Dashboard</h1>
    <div class="space-x-3">
      <a href="/admin/add" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700">+ Add Programme</a>
      <a href="/admin/roster" class="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-semibold hover:bg-slate-300">Roster</a>
      <a href="/admin/logout" class="text-slate-500 hover:underline">Log out</a>
    </div>
  </div>
  <div class="bg-white rounded-xl shadow overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-600 text-left">
        <tr><th class="px-4 py-3">Programme</th><th class="px-4 py-3">Date</th><th class="px-4 py-3">Time</th><th class="px-4 py-3">Status</th><th class="px-4 py-3 text-center">Count</th><th class="px-4 py-3">Actions</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">No programmes yet. Click "Add Programme" to create one.</td></tr>'}</tbody>
    </table>
  </div>
</div>
<script>
// Keep status badges live without a page refresh.
function refreshStatuses() {
  document.querySelectorAll('.status-badge').forEach(b => {
    const now = Date.now();
    const start = new Date(b.dataset.date + 'T' + b.dataset.start).getTime();
    const end = new Date(b.dataset.date + 'T' + b.dataset.end).getTime();
    let label, cls;
    if (now < start) { label = 'Upcoming'; cls = 'bg-amber-100 text-amber-800'; }
    else if (now > end) { label = 'Closed'; cls = 'bg-slate-200 text-slate-600'; }
    else { label = 'Open'; cls = 'bg-emerald-100 text-emerald-800'; }
    b.textContent = label;
    b.className = 'px-2 py-1 rounded-full text-xs font-semibold status-badge ' + cls;
  });
}
refreshStatuses();
setInterval(refreshStatuses, 30000);
// Poll live attendance counts every 5s during events.
async function refreshCounts() {
  try {
    const r = await fetch('/admin/counts');
    const data = await r.json();
    document.querySelectorAll('.count-cell').forEach(c => { if (data[c.dataset.id] != null) c.textContent = data[c.dataset.id]; });
  } catch (e) {}
}
setInterval(refreshCounts, 5000);
</script>`
  }));
});

// ---- add programme ----
router.get('/add', requireAuth, (req, res) => {
  res.send(page({
    title: 'Add Programme',
    body: `
<div class="max-w-2xl mx-auto p-6">
  <a href="/admin" class="text-indigo-600 hover:underline text-sm">&larr; Back to dashboard</a>
  <h1 class="text-2xl font-bold text-slate-800 mt-2 mb-6">Add a Programme</h1>
  <form method="POST" action="/admin/add" class="bg-white rounded-xl shadow p-6 space-y-5">
    <div>
      <label class="block text-sm font-semibold text-slate-700 mb-1">Programme name</label>
      <input name="name" class="w-full border rounded-lg px-3 py-2" required>
    </div>
    <div class="grid grid-cols-3 gap-4">
      <div>
        <label class="block text-sm font-semibold text-slate-700 mb-1">Date</label>
        <input name="date" type="date" class="w-full border rounded-lg px-3 py-2" required>
      </div>
      <div>
        <label class="block text-sm font-semibold text-slate-700 mb-1">Start time</label>
        <input name="start_time" type="time" class="w-full border rounded-lg px-3 py-2" required>
      </div>
      <div>
        <label class="block text-sm font-semibold text-slate-700 mb-1">End time</label>
        <input name="end_time" type="time" class="w-full border rounded-lg px-3 py-2" required>
      </div>
    </div>
    <div>
      <label class="block text-sm font-semibold text-slate-700 mb-1">Location — click the map to place the centre, then set the allowed radius</label>
      <div id="map" class="h-72 rounded-lg border z-0"></div>      <input type="hidden" name="lat" id="lat">
      <input type="hidden" name="lng" id="lng">
      <div class="mt-3 flex items-center gap-3">
        <input type="range" id="radius" name="radius_m" min="20" max="1000" value="100" step="10" class="flex-1" required>
        <span class="text-sm font-semibold text-slate-700 w-32">Radius: <span id="radiusVal">100</span> m</span>
      </div>
    </div>
    <button class="w-full bg-indigo-600 text-white rounded-lg py-2.5 font-semibold hover:bg-indigo-700">Create Programme</button>
  </form>
</div>
<script>
// Google Maps raster tiles via MapLibre GL — streets + satellite with a toggle.
const googleRaster = style =>
  ({ version: 8, sources: {
      google: { type: 'raster', tiles: ['https://mt0.google.com/vt/lyrs=' + style + '&x={x}&y={y}&z={z}', 'https://mt1.google.com/vt/lyrs=' + style + '&x={x}&y={y}&z={z}', 'https://mt2.google.com/vt/lyrs=' + style + '&x={x}&y={y}&z={z}', 'https://mt3.google.com/vt/lyrs=' + style + '&x={x}&y={y}&z={z}'], tileSize: 256, attribution: '&copy; Google Maps' }
    }, layers: [{ id: 'google', type: 'raster', source: 'google' }] });

const map = new maplibregl.Map({
  container: 'map',
  style: googleRaster('m'), // streets; toggled to satellite below
  center: [101.6869, 3.139],
  zoom: 13,
  attributionControl: false
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true }), 'top-right');

// Style toggle button (Map / Satellite)
const styleBtn = document.createElement('button');
styleBtn.textContent = 'Satellite';
styleBtn.className = 'maplibregl-ctrl-group absolute top-2 left-2 z-10 bg-white px-3 py-1.5 text-xs font-semibold rounded shadow hover:bg-slate-100';
let isSatellite = false;
styleBtn.addEventListener('click', () => {
  isSatellite = !isSatellite;
  styleBtn.textContent = isSatellite ? 'Map' : 'Satellite';
  map.setStyle(googleRaster(isSatellite ? 'y' : 'm'));
  map.once('styledata', () => { redrawAll(); });
});
document.getElementById('map').appendChild(styleBtn);

let marker, circle, lngLat = null;
const radiusInput = document.getElementById('radius');

function redrawAll() {
  if (marker) marker.remove();
  if (circle) circle.remove();
  if (lngLat) place(lngLat[0], lngLat[1], false);
}
function place(lng, lat, center = false) {
  lngLat = [lng, lat];
  document.getElementById('lat').value = lat;
  document.getElementById('lng').value = lng;
  if (!marker) {
    marker = new maplibregl.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(map);
    marker.on('drag', () => { const p = marker.getLngLat(); lngLat = [p.lng, p.lat]; document.getElementById('lat').value = p.lat; document.getElementById('lng').value = p.lng; drawCircle(); });
    marker.on('dragend', () => { const p = marker.getLngLat(); place(p.lng, p.lat); });
  } else {
    marker.setLngLat([lng, lat]);
  }
  drawCircle();
  if (center) map.easeTo({ center: [lng, lat] });
}
function drawCircle() {
  const lat = parseFloat(document.getElementById('lat').value), lng = parseFloat(document.getElementById('lng').value);
  const r = parseFloat(radiusInput.value);
  document.getElementById('radiusVal').textContent = r;
  if (!lat) return;
  if (circle) circle.remove();
  circle = { remove() {} };
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lng + (r / 111320 / Math.cos(lat * Math.PI / 180)) * Math.cos(a), lat + (r / 110540) * Math.sin(a)]);
  }
  if (map.getLayer('radius-fill')) map.removeLayer('radius-fill');
  if (map.getLayer('radius-line')) map.removeLayer('radius-line');
  if (map.getSource('radius')) map.removeSource('radius');
  map.addSource('radius', { type: 'geojson', data: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
  map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#4f46e5', 'fill-opacity': 0.25 } });
  map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#4f46e5', 'line-width': 2.5 } });
}
map.on('click', e => place(e.lngLat.lng, e.lngLat.lat));
radiusInput.addEventListener('input', drawCircle);
document.querySelector('form').addEventListener('submit', e => {
  if (!document.getElementById('lat').value) { alert('Please click the map to set the programme location.'); e.preventDefault(); }
});
// Jump to the admin's actual location on load + persistent blue "you are here" dot.
map.on('load', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    p => { map.jumpTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 }); showYou(p); },
    err => console.warn('Geolocation unavailable:', err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
  navigator.geolocation.watchPosition(showYou, () => {}, { enableHighAccuracy: true });
});
let youLayerAdded = false;
function showYou(p) {
  const lng = p.coords.longitude, lat = p.coords.latitude, acc = p.coords.accuracy || 30;
  // accuracy circle
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lng + (acc / 111320 / Math.cos(lat * Math.PI / 180)) * Math.cos(a), lat + (acc / 110540) * Math.sin(a)]);
  }
  if (map.getSource('you')) { map.getSource('you').setData({ type: 'Point', coordinates: [lng, lat] }); }
  else map.addSource('you', { type: 'geojson', data: { type: 'Point', coordinates: [lng, lat] } });
  if (!youLayerAdded) {
    map.addLayer({ id: 'you-dot', type: 'circle', source: 'you', paint: { 'circle-radius': 8, 'circle-color': '#2563eb', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
    youLayerAdded = true;
  }
  if (map.getSource('you-acc')) { map.getSource('you-acc').setData({ type: 'Polygon', coordinates: [[...pts, pts[0]]] }); }
  else {
    map.addSource('you-acc', { type: 'geojson', data: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
    map.addLayer({ id: 'you-acc-fill', type: 'fill', source: 'you-acc', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.15 } });
  }
}
// the style toggle wipes layers — redraw your dot too
const origRedraw = redrawAll;
redrawAll = function() { origRedraw(); youLayerAdded = false; };
</script>`
  }));
});

router.post('/add', requireAuth, (req, res) => {
  const { name, date, start_time, end_time, lat, lng, radius_m } = req.body;
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO programmes (name, date, start_time, end_time, lat, lng, radius_m, token) VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, date, start_time, end_time, parseFloat(lat), parseFloat(lng), parseInt(radius_m), token);
  res.redirect('/admin');
});

router.post('/programme/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM attendances WHERE programme_id = ?').run(req.params.id);
  db.prepare('DELETE FROM programmes WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// ---- student roster ----
router.get('/roster', requireAuth, (req, res) => {
  const students = db.prepare('SELECT * FROM students ORDER BY student_id').all();
  const trs = students.map(s => `<tr class="border-b hover:bg-slate-50">
    <td class="px-4 py-2 font-medium">${s.student_id}</td>
    <td class="px-4 py-2">${s.name}</td>
    <td class="px-4 py-2">
      <form method="POST" action="/admin/roster/delete/${s.id}" class="inline" onsubmit="return confirm('Remove ${s.student_id} from the roster?')">
        <button class="text-red-600 hover:underline">Remove</button>
      </form>
    </td>
  </tr>`).join('');
  res.send(page({
    title: 'Student Roster',
    body: `
<div class="max-w-4xl mx-auto p-6">
  <a href="/admin" class="text-indigo-600 hover:underline text-sm">&larr; Back to dashboard</a>
  <h1 class="text-2xl font-bold text-slate-800 mt-2 mb-6">Student Roster <span class="text-slate-400 text-lg font-normal">(${students.length} students)</span></h1>
  <div class="bg-white rounded-xl shadow p-6 mb-6">
    <h2 class="font-semibold text-slate-700 mb-2">Import students (CSV)</h2>
    <p class="text-sm text-slate-500 mb-3">Upload a CSV with columns <code class="bg-slate-100 px-1 rounded">student_id</code> and <code class="bg-slate-100 px-1 rounded">name</code> (header row required, any column order). Existing student IDs are updated with the new name. Example:</p>
    <pre class="bg-slate-50 border rounded p-3 text-xs text-slate-600 mb-4">student_id,name
A123456,Ali bin Ahmad
A123457,Siti Nurhaliza</pre>
    ${req.query.err ? '<p class="mb-3 text-sm text-red-600 bg-red-50 rounded p-2">' + req.query.err + '</p>' : ''}
    ${req.query.ok ? '<p class="mb-3 text-sm text-emerald-700 bg-emerald-50 rounded p-2">Imported: ' + req.query.ok + ' new, ' + req.query.upd + ' updated.</p>' : ''}
    <form method="POST" action="/admin/roster/import" enctype="multipart/form-data" class="flex items-center gap-3">
      <input type="file" name="csv" accept=".csv,text/csv" class="flex-1 border rounded-lg px-3 py-2 text-sm" required>
      <button class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700">Import</button>
    </form>
  </div>
  <div class="bg-white rounded-xl shadow overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-600 text-left">
        <tr><th class="px-4 py-3">Student ID</th><th class="px-4 py-3">Name</th><th class="px-4 py-3"></th></tr>
      </thead>
      <tbody>${trs || '<tr><td colspan="3" class="px-4 py-8 text-center text-slate-400">No students imported yet.</td></tr>'}</tbody>
    </table>
  </div>
</div>`
  }));
});

router.post('/roster/import', requireAuth, (req, res) => {
  if (!req.files || !req.files.csv) return res.redirect('/admin/roster?err=' + encodeURIComponent('No file uploaded.'));
  const content = req.files.csv.toString('utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return res.redirect('/admin/roster?err=' + encodeURIComponent('CSV needs a header row and at least one student.'));
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  const idCol = header.findIndex(h => h === 'student_id' || h === 'id' || h === 'matric');
  const nameCol = header.findIndex(h => h === 'name' || h === 'student_name' || h === 'full name');
  if (idCol === -1 || nameCol === -1) return res.redirect('/admin/roster?err=' + encodeURIComponent('CSV must have "student_id" and "name" columns in the header row.'));
  const upsert = db.prepare(`INSERT INTO students (student_id, name) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET name = excluded.name`);
  const existing = new Set(db.prepare('SELECT student_id FROM students').all().map(s => s.student_id));
  let added = 0, updated = 0, skipped = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const sid = cols[idCol], name = cols[nameCol];
    if (!sid || !name) { skipped++; continue; }
    if (existing.has(sid)) { updated++; } else { added++; existing.add(sid); }
    upsert.run(sid, name);
  }
  res.redirect(`/admin/roster?ok=${added}&upd=${updated}${skipped ? '&err=' + encodeURIComponent(skipped + ' rows skipped (missing ID or name).') : ''}`);
});

router.post('/roster/delete/:sid', requireAuth, (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.sid);
  res.redirect('/admin/roster');
});

// Live counts for dashboard polling
router.get('/counts', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT programme_id, COUNT(*) AS c FROM attendances GROUP BY programme_id').all();
  res.json(Object.fromEntries(rows.map(r => [r.programme_id, r.c])));
});

// ---- QR / link ----
router.get('/programme/:id/qr', requireAuth, async (req, res) => {
  const p = db.prepare('SELECT * FROM programmes WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).send('Not found');
  const url = `${req.protocol}://${req.get('host')}/a/${p.token}`;
  const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
  res.send(page({
    title: 'QR Code',
    body: `
<div class="max-w-md mx-auto p-6 text-center">
  <a href="/admin" class="text-indigo-600 hover:underline text-sm">&larr; Back to dashboard</a>
  <div class="bg-white rounded-xl shadow p-8 mt-4">
    <h1 class="text-xl font-bold text-slate-800">${p.name}</h1>
    <p class="text-slate-500 text-sm mb-4">${p.date} · ${p.start_time} – ${p.end_time}</p>
    <img src="${dataUrl}" alt="QR code" class="mx-auto rounded border">
    <p class="mt-4 text-sm break-all text-slate-600">${url}</p>
    <div class="mt-4 space-x-2">
      <a href="${dataUrl}" download="qr-${p.token}.png" class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700">Download QR</a>
      <button onclick="copyLink()" class="bg-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-300">Copy link</button>
    </div>
    <p class="mt-4 text-xs text-slate-400">Each programme has a unique token, so every QR/link is one-of-a-kind and never repeats.</p>
  </div>
</div>
<script>function copyLink(){navigator.clipboard.writeText('${url}').then(()=>alert('Link copied!'))}</script>`
  }));
});

// ---- attendance list ----
router.get('/programme/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM programmes WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).send('Not found');
  const rows = db.prepare('SELECT * FROM attendances WHERE programme_id = ? ORDER BY created_at').all(p.id);
  const trs = rows.map(a => `<tr class="border-b hover:bg-slate-50 cursor-pointer student-row" data-lat="${a.lat ?? ''}" data-lng="${a.lng ?? ''}" data-id="${a.student_id}" data-name="${a.student_name}" data-late="${a.late}" data-dist="${a.distance_m ?? ''}">
    <td class="px-4 py-2 font-medium">${a.student_id}</td>
    <td class="px-4 py-2">${a.student_name}</td>
    <td class="px-4 py-2">${a.created_at} UTC</td>
    <td class="px-4 py-2">${a.late ? '<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Late</span>' : '<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">On time</span>'}</td>
    <td class="px-4 py-2">${a.distance_m == null ? '—' : Math.round(a.distance_m) + ' m'}</td>
    <td class="px-4 py-2 text-slate-500">${a.ip || '—'}</td>
  </tr>`).join('');
  const pins = rows.filter(a => a.lat != null && a.lng != null)
    .map(a => ({ lng: a.lng, lat: a.lat, id: a.student_id, name: a.student_name, late: a.late, dist: a.distance_m }));
  const failed = db.prepare('SELECT * FROM failed_attempts WHERE programme_id = ? ORDER BY created_at DESC LIMIT 200').all(p.id);
  const failedTrs = failed.map(f => {
    const reasonLabel = {
      outside_radius: 'Outside venue radius',
      low_accuracy: 'Location not precise',
      stale_location: 'Stale location',
      too_early: 'Before start time',
      closed: 'After closing',
      not_on_roster: 'Not on roster',
      name_mismatch: 'Name mismatch',
      duplicate_device: 'Duplicate device',
      duplicate_student: 'Duplicate student',
      server_error: 'Server error'
    }[f.reason] || f.reason;
    return `<tr class="border-b hover:bg-slate-50">
      <td class="px-4 py-2 font-medium">${f.student_id}</td>
      <td class="px-4 py-2">${f.student_name}</td>
      <td class="px-4 py-2"><span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">${reasonLabel}</span></td>
      <td class="px-4 py-2">${f.distance_m != null ? Math.round(f.distance_m) + ' m' : '—'}</td>
      <td class="px-4 py-2 text-slate-500">${f.created_at} UTC</td>
      <td class="px-4 py-2 text-slate-500">${f.ip || '—'}</td>
    </tr>`;
  }).join('');
  res.send(page({
    title: `Attendance — ${p.name}`,
    body: `
<div class="max-w-5xl mx-auto p-6">
  <a href="/admin" class="text-indigo-600 hover:underline text-sm">&larr; Back to dashboard</a>
  <div class="flex justify-between items-center mt-2 mb-6">
    <div>
      <h1 class="text-2xl font-bold text-slate-800">${p.name}</h1>
      <p class="text-slate-500 text-sm">${p.date} · ${p.start_time} – ${p.end_time} · ${rows.length} submissions</p>
    </div>
    <a href="/admin/programme/${p.id}/csv" class="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700">Export CSV</a>
  </div>
  <div class="bg-white rounded-xl shadow p-4 mb-6">
    <div class="flex justify-between items-center mb-2">
      <h2 class="font-semibold text-slate-700">Check-in map</h2>
      <div class="flex items-center gap-4 text-xs text-slate-500">
        <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full bg-emerald-500"></span> On time</span>
        <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full bg-amber-500"></span> Late</span>
        <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-full border-2 border-indigo-600"></span> Venue radius (${p.radius_m} m)</span>
      </div>
    </div>
    <div id="attmap" class="h-80 rounded-lg border z-0"></div>
  </div>
  <div class="bg-white rounded-xl shadow overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-600 text-left">
        <tr><th class="px-4 py-3">Student ID</th><th class="px-4 py-3">Name</th><th class="px-4 py-3">Time</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Distance from venue</th><th class="px-4 py-3">IP</th></tr>
      </thead>
      <tbody>${trs || '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">No attendance yet.</td></tr>'}</tbody>
    </table>
  </div>
  ${failed.length ? `
  <div class="bg-white rounded-xl shadow overflow-x-auto mt-6">
    <div class="px-4 py-3 bg-red-50 border-b flex items-center gap-2">
      <h2 class="font-semibold text-red-700">Rejected attempts</h2>
      <span class="text-xs text-red-500">(${failed.length} recorded — students were shown an error and do not know this was logged)</span>
    </div>
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-600 text-left">
        <tr><th class="px-4 py-3">Student ID</th><th class="px-4 py-3">Name</th><th class="px-4 py-3">Reason</th><th class="px-4 py-3">Distance from venue</th><th class="px-4 py-3">Time</th><th class="px-4 py-3">IP</th></tr>
      </thead>
      <tbody>${failedTrs}</tbody>
    </table>
  </div>` : ''}
</div>
<script>
const venue = { lat: ${p.lat}, lng: ${p.lng}, radius: ${p.radius_m} };
const pins = ${JSON.stringify(pins)};
const map2 = new maplibregl.Map({
  container: 'attmap',
  style: { version: 8, sources: { google: { type: 'raster', tiles: ['https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'], tileSize: 256 } }, layers: [{ id: 'google', type: 'raster', source: 'google' }] },
  center: [venue.lng, venue.lat],
  zoom: 16,
  attributionControl: false
});
map2.addControl(new maplibregl.NavigationControl(), 'top-right');
map2.on('load', () => {
  // venue radius circle (indigo)
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([venue.lng + (venue.radius / 111320 / Math.cos(venue.lat * Math.PI / 180)) * Math.cos(a), venue.lat + (venue.radius / 110540) * Math.sin(a)]);
  }
  map2.addSource('venue-radius', { type: 'geojson', data: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
  map2.addLayer({ id: 'venue-fill', type: 'fill', source: 'venue-radius', paint: { 'fill-color': '#4f46e5', 'fill-opacity': 0.08 } });
  map2.addLayer({ id: 'venue-line', type: 'line', source: 'venue-radius', paint: { 'line-color': '#4f46e5', 'line-width': 2 } });
  // venue centre marker (dark pin)
  new maplibregl.Marker({ color: '#1e1b4b' }).setLngLat([venue.lng, venue.lat]).setPopup(new maplibregl.Popup().setText('Venue centre')).addTo(map2);
  // one dot per respondent, green = on time, amber = late
  map2.addSource('students', { type: 'geojson', data: { type: 'FeatureCollection', features: pins.map(s => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { late: s.late ? 1 : 0 } })) } });
  map2.addLayer({ id: 'student-dots', type: 'circle', source: 'students',
    paint: { 'circle-radius': 7, 'circle-color': ['case', ['==', ['get', 'late'], 1], '#f59e0b', '#10b981'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
  map2.on('click', 'student-dots', e => {
    const f = e.features[0];
    const s = pins.find(p => p.lng === f.geometry.coordinates[0] && p.lat === f.geometry.coordinates[1]);
    if (s) new maplibregl.Popup().setLngLat(f.geometry.coordinates).setHTML('<b>' + s.id + '</b> — ' + s.name + '<br>' + (s.late ? 'Late' : 'On time') + ' · ' + Math.round(s.dist) + ' m from venue').addTo(map2);
  });
  // fit view to include all pins
  if (pins.length) {
    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([venue.lng, venue.lat]);
    pins.forEach(s => bounds.extend([s.lng, s.lat]));
    map2.fitBounds(bounds, { padding: 60, maxZoom: 17 });
  }
  // clicking a table row flies the map to that student's pin
  let selectedStudent;
  document.querySelectorAll('.student-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const lat = parseFloat(tr.dataset.lat), lng = parseFloat(tr.dataset.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      map2.flyTo({ center: [lng, lat], zoom: 18, essential: true });
      if (selectedStudent) selectedStudent.remove();
      selectedStudent = new maplibregl.Popup({ closeOnClick: false, offset: 12 })
        .setLngLat([lng, lat])
        .setHTML('<b>' + tr.dataset.id + '</b> — ' + tr.dataset.name + '<br>' + (tr.dataset.late === '1' ? 'Late' : 'On time') + (tr.dataset.dist ? ' · ' + Math.round(tr.dataset.dist) + ' m from venue' : ''))
        .addTo(map2);
      tr.scrollIntoView({ block: 'nearest' });
    });
  });
});
</script>`
  }));
});

router.get('/programme/:id/csv', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM programmes WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).send('Not found');
  const rows = db.prepare('SELECT * FROM attendances WHERE programme_id = ? ORDER BY created_at').all(p.id);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Student ID,Name,Timestamp,Status,Latitude,Longitude,Distance (m),Accuracy (m),IP',
    ...rows.map(a => [a.student_id, a.student_name, a.created_at, a.late ? 'Late' : 'On time', a.lat, a.lng, a.distance_m, a.accuracy_m, a.ip].map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${p.id}.csv"`);
  res.send(csv);
});

module.exports = router;
