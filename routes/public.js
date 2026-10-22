const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { page } = require('../views/layout');

const router = express.Router();

// Public IP limit: max distinct students allowed from a single IP (shared WiFi / NAT protection).
const MAX_PER_IP = parseInt(process.env.MAX_PER_IP || '15', 10);

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formPage(token, { error = null, name = '', studentId = '' } = {}) {
  return page({
    title: 'Attendance Check-in',
    body: `
<div class="max-w-md mx-auto p-6 mt-10">
  <div class="bg-white rounded-xl shadow p-8">
    <h1 class="text-2xl font-bold text-slate-800 text-center mb-1">Attendance Check-in</h1>
    <p class="text-center text-slate-500 text-sm mb-6" id="progName">Loading programme…</p>
    <div id="errBox" class="hidden mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3"></div>
    <form id="form" class="space-y-4">
      <div>
        <label class="block text-sm font-semibold text-slate-700 mb-1">Student ID</label>
        <input id="studentId" value="${studentId}" class="w-full border rounded-lg px-3 py-2" placeholder="e.g. A123456" required>
      </div>
      <div>
        <label class="block text-sm font-semibold text-slate-700 mb-1">Full name</label>
        <input id="studentName" value="${name}" class="w-full border rounded-lg px-3 py-2" required>
      </div>
      <button id="submitBtn" class="w-full bg-indigo-600 text-white rounded-lg py-2.5 font-semibold hover:bg-indigo-700 disabled:opacity-50">Check in</button>
    </form>
    <p class="mt-4 text-xs text-slate-400 text-center">Your GPS location and device ID will be recorded to verify you are at the venue.</p>
  </div>
</div>
<script>
const TOKEN = '${token}';
const errBox = document.getElementById('errBox');
function showError(msg){ errBox.textContent = msg; errBox.classList.remove('hidden'); }

// Stable per-device token stored in localStorage.
let deviceHash = localStorage.getItem('deviceHash');
if (!deviceHash) {
  deviceHash = crypto.randomUUID();
  localStorage.setItem('deviceHash', deviceHash);
}

fetch('/api/programme/' + TOKEN).then(r => { if (!r.ok) throw new Error(); return r.json(); })
  .then(p => {
    document.getElementById('progName').textContent = p.name + ' · ' + p.date + ' · ' + p.start_time + ' – ' + p.end_time;
    if (p.status !== 'Open') showError('This attendance is not open right now (' + p.status + ').');
  })
  .catch(() => { showError('Invalid or expired attendance link.'); document.getElementById('submitBtn').disabled = true; });

document.getElementById('form').addEventListener('submit', e => {
  e.preventDefault();
  errBox.classList.add('hidden');
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Getting your location…';
  if (!navigator.geolocation) {
    btn.disabled = false; btn.textContent = 'Check in';
    return showError('Your browser does not support location. Please enable location or use another device.');
  }
  navigator.geolocation.getCurrentPosition(async pos => {
    btn.textContent = 'Submitting…';
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: TOKEN,
          student_id: document.getElementById('studentId').value.trim(),
          student_name: document.getElementById('studentName').value.trim(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          age_ms: pos.timestamp ? Date.now() - pos.timestamp : null,
          device_hash: deviceHash
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed.');
      const t = new Date(data.checkin_time);
      document.querySelector('.bg-white').innerHTML =
        '<div class="text-center py-6"><div class="text-5xl mb-4">✅</div>' +
        '<h2 class="text-2xl font-bold text-emerald-600 mb-2">Attendance recorded!</h2>' +
        (data.late ? '<p class="mb-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">Recorded as <b>late arrival</b>.</p>' : '') +
        '<div class="text-left text-sm bg-slate-50 rounded-lg p-4 space-y-1 border">' +
        '<div class="flex justify-between"><span class="text-slate-500">Name</span><b>' + data.student_name + '</b></div>' +
        '<div class="flex justify-between"><span class="text-slate-500">Check-in time</span><b>' + t.toLocaleTimeString() + '</b></div>' +
        '<div class="flex justify-between"><span class="text-slate-500">Receipt</span><b>' + data.receipt + '</b></div>' +
        '</div>' +
        '<p class="mt-3 text-xs text-slate-400">Screenshot this receipt as proof of check-in.</p></div>';
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Check in';
      showError(err.message);
    }
  }, err => {
    btn.disabled = false; btn.textContent = 'Check in';
    showError('Could not get your location (' + err.message + '). Please enable GPS/location and try again.');
  }, { enableHighAccuracy: true, timeout: 15000 });
});
</script>`
  });
}

// Programme info for the form page
router.get('/api/programme/:token', (req, res) => {
  const p = db.prepare('SELECT * FROM programmes WHERE token = ?').get(req.params.token);
  if (!p) return res.status(404).json({ error: 'Invalid link.' });
  res.json({ name: p.name, date: p.date, start_time: p.start_time, end_time: p.end_time, status: publicStatus(p) });
});

function publicStatus(p) {
  const now = new Date();
  if (now < new Date(`${p.date}T${p.start_time}`)) return 'Upcoming';
  if (now > new Date(`${p.date}T${p.end_time}`)) return 'Closed';
  return 'Open';
}

// Attendance form
router.get('/a/:token', (req, res) => {
  const p = db.prepare('SELECT * FROM programmes WHERE token = ?').get(req.params.token);
  if (!p) return res.status(404).send(page({ title: 'Not found', body: '<div class="max-w-md mx-auto mt-24 bg-white rounded-xl shadow p-8 text-center"><h1 class="text-xl font-bold text-red-600">Invalid link</h1><p class="text-slate-500 mt-2">This attendance link does not exist.</p></div>' }));
  res.send(formPage(p.token));
});

// Submission
router.post('/api/checkin', (req, res) => {
  const { token, student_id, student_name, lat, lng, accuracy, age_ms, device_hash } = req.body || {};
  const fail = msg => res.status(400).json({ error: msg });

  const p = db.prepare('SELECT * FROM programmes WHERE token = ?').get(token);
  if (!p) return fail('Invalid attendance link.');
  if (!student_id || !student_name) return fail('Please enter your student ID and full name.');
  if (typeof lat !== 'number' || typeof lng !== 'number') return fail('Location is required. Please enable GPS and try again.');

  // GPS quality: reject inaccurate or stale readings so students retry with a fresh fix.
  if (typeof accuracy === 'number' && accuracy > 100) {
    return fail(`Your location is not precise enough (±${Math.round(accuracy)} m). Step outside or near a window and try again.`);
  }
  if (typeof age_ms === 'number' && age_ms > 60000) {
    return fail('Your location reading is stale. Please tap Check in again.');
  }

  const now = new Date();
  const start = new Date(`${p.date}T${p.start_time}`);
  const end = new Date(`${p.date}T${p.end_time}`);
  if (now < start) return fail('This attendance is not open yet. It starts at ' + p.start_time + '.');
  if (now > end) return fail('This attendance has closed at ' + p.end_time + '.');
  // Grace period: check-ins more than 15 min after start are flagged Late (still accepted).
  const late = now.getTime() > start.getTime() + 15 * 60 * 1000 ? 1 : 0;

  // Roster check: when a roster exists, only registered students may check in,
  // and the name must match the registered one.
  const registered = db.prepare('SELECT * FROM students WHERE student_id = ?').get(student_id);
  const rosterCount = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
  if (rosterCount > 0) {
    if (!registered) return fail(`Student ID ${student_id} is not on the roster for this programme. Please check your ID or contact the organizer.`);
    if (registered.name.toLowerCase() !== student_name.trim().toLowerCase()) {
      return fail(`The name registered for ${student_id} is "${registered.name}". Please enter your name exactly as registered.`);
    }
  }

  const device = String(device_hash || '');
  if (!device) return fail('Device ID missing. Please use a normal browser.');

  const ip = req.ip.replace('::ffff:', '');

  try {
    const distance = haversine(p.lat, p.lng, lat, lng);
    if (distance > p.radius_m) {
      return fail(`You appear to be ${Math.round(distance)} m away from the venue (allowed: ${p.radius_m} m). You must be at the programme location to check in.`);
    }
    db.prepare(`INSERT INTO attendances (programme_id, student_id, student_name, ip, device_hash, lat, lng, distance_m, accuracy_m, late)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(p.id, student_id, student_name, ip, device, lat, lng, distance,
           typeof accuracy === 'number' ? accuracy : null, late);
    const row = db.prepare('SELECT id FROM attendances WHERE programme_id = ? AND student_id = ?').get(p.id, student_id);
    return res.json({ ok: true, student_name, late: !!late, receipt: 'ATD-' + String(row.id).padStart(5, '0'), checkin_time: now.toISOString() });
  } catch (e) {
    if (/UNIQUE constraint failed.*device_hash/.test(e.message)) return fail('This device has already checked in for this programme. You cannot check in for a friend.');
    if (/UNIQUE constraint failed.*student_id/.test(e.message)) return fail(`Attendance already recorded for student ID ${student_id}. You cannot check in twice.`);
    console.error(e);
    return fail('Something went wrong. Please try again.');
  }

  // Log a warning if one IP submitted too many distinct students (possible proxy filling).
  const ipCount = db.prepare('SELECT COUNT(DISTINCT student_id) AS c FROM attendances WHERE programme_id = ? AND ip = ?').get(p.id, ip).c;
  if (ipCount > MAX_PER_IP) {
    console.warn(`[ALERT] Programme ${p.id}: ${ipCount} distinct students checked in from IP ${ip}`);
  }

  res.json({ ok: true, student_name });
});

router.get('/', (req, res) => res.redirect('/admin/login'));

module.exports = router;
