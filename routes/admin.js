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
      <td class="px-4 py-3 text-center font-semibold">${p.count}</td>
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
      <div id="map" class="h-72 rounded-lg border z-0"></div>
      <input type="hidden" name="lat" id="lat">
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
const map = L.map('map').setView([3.139, 101.6869], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
let marker, circle;
function place(lat, lng) {
  document.getElementById('lat').value = lat;
  document.getElementById('lng').value = lng;
  if (marker) { marker.setLatLng([lat, lng]); } else { marker = L.marker([lat, lng], { draggable: true }).addTo(map); marker.on('dragend', e => place(e.target.getLatLng().lat, e.target.getLatLng().lng)); }
  drawCircle();
}
function drawCircle() {
  const lat = document.getElementById('lat').value, lng = document.getElementById('lng').value, r = parseInt(document.getElementById('radius').value);
  document.getElementById('radiusVal').textContent = r;
  if (!lat) return;
  if (circle) circle.setLatLng([lat, lng]).setRadius(r); else circle = L.circle([lat, lng], { radius: r, color: '#4f46e5', fillOpacity: 0.15 }).addTo(map);
}
map.on('click', e => place(e.latlng.lat, e.latlng.lng));
document.getElementById('radius').addEventListener('input', drawCircle);
document.querySelector('form').addEventListener('submit', e => {
  if (!document.getElementById('lat').value) { alert('Please click the map to set the programme location.'); e.preventDefault(); }
});
if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 15));
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
  const trs = rows.map(a => `<tr class="border-b hover:bg-slate-50">
    <td class="px-4 py-2 font-medium">${a.student_id}</td>
    <td class="px-4 py-2">${a.student_name}</td>
    <td class="px-4 py-2">${a.created_at} UTC</td>
    <td class="px-4 py-2">${a.distance_m == null ? '—' : Math.round(a.distance_m) + ' m'}</td>
    <td class="px-4 py-2 text-slate-500">${a.ip || '—'}</td>
  </tr>`).join('');
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
  <div class="bg-white rounded-xl shadow overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-600 text-left">
        <tr><th class="px-4 py-3">Student ID</th><th class="px-4 py-3">Name</th><th class="px-4 py-3">Time</th><th class="px-4 py-3">Distance from venue</th><th class="px-4 py-3">IP</th></tr>
      </thead>
      <tbody>${trs || '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">No attendance yet.</td></tr>'}</tbody>
    </table>
  </div>
</div>`
  }));
});

router.get('/programme/:id/csv', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM programmes WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).send('Not found');
  const rows = db.prepare('SELECT * FROM attendances WHERE programme_id = ? ORDER BY created_at').all(p.id);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Student ID,Name,Timestamp,Latitude,Longitude,Distance (m),IP',
    ...rows.map(a => [a.student_id, a.student_name, a.created_at, a.lat, a.lng, a.distance_m, a.ip].map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${p.id}.csv"`);
  res.send(csv);
});

module.exports = router;
