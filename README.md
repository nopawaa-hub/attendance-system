# Attendance System

A geofenced attendance platform: admins create programmes with a time window and a map-drawn location radius; students check in via a unique per-programme link/QR that verifies their GPS location, student ID, device, and IP.

## Run

```
npm install
npm start
```

Open http://localhost:3000 — default admin login is **admin / admin123**.

## Configuration (optional, via environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Server port |
| `ADMIN_USER` | admin | Admin username |
| `ADMIN_PASS` | admin123 | Admin password — **change this** |
| `SESSION_SECRET` | change-me | Session signing secret |
| `MAX_PER_IP` | 15 | Alert threshold for distinct students per IP (proxy-filling detector) |

## How it works

**Admin side** (`/admin`): log in → "Add Programme" → set name, date, start/end time → click the map to place the venue centre and drag the radius slider (20–1000 m) → create. Each programme gets a unique token, so every link `/a/<token>` and its QR code never repeat. Dashboard shows counts and open/closed status; per-programme view lists every submission (ID, name, time, GPS distance from venue, IP) with CSV export.

**Student side**: scan QR / open link → enter student ID + name → browser requests GPS → server validates:
1. Link token is valid
2. Current time is within the programme window
3. GPS is inside the admin-set radius (haversine distance)
4. Student ID not already used for this programme
5. Device (localStorage token) not already used for this programme — blocks checking in for friends
6. IP is logged for audit; an alert is printed when one IP exceeds `MAX_PER_IP` distinct students

Duplicates at steps 4/5 are hard-blocked by unique database indexes, not just application checks.

## Notes & limits

- Everyone on the same venue WiFi shares one public IP, so IP is recorded for audit/alerting rather than used to block individuals — the device token + student ID are the per-person blocks.
- GPS can be spoofed on rooted/jailbroken devices; combine with human spot-checks for high-stakes events.
- Data is stored in `attendance.db` (SQLite, WAL mode).
