const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'attendance.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS programmes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_m INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  programme_id INTEGER NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  ip TEXT,
  device_hash TEXT NOT NULL,
  lat REAL,
  lng REAL,
  distance_m REAL,
  accuracy_m REAL,
  late INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prog_student ON attendances(programme_id, student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prog_device ON attendances(programme_id, device_hash);
`);

// Late column added after initial release; safe for existing databases.
try { db.exec('ALTER TABLE attendances ADD COLUMN late INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE attendances ADD COLUMN accuracy_m REAL'); } catch (e) { /* already exists */ }

module.exports = db;
