const express = require('express');
const session = require('express-session');
const path = require('path');

const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true); // so req.ip is the real client IP behind proxies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => { // minimal multipart handling for the roster CSV upload
  if (req.method === 'POST' && req.headers['content-type']?.includes('multipart/form-data')) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const boundary = req.headers['content-type'].split('boundary=')[1];
      const parts = buf.toString('binary').split('--' + boundary);
      req.files = {};
      for (const part of parts) {
        const m = part.match(/name="([^"]+)"[^]*?\r\n\r\n([\s\S]*?)\r\n$/);
        if (m) req.files[m[1]] = Buffer.from(m[2], 'binary');
      }
      next();
    });
  } else next();
});
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.listen(PORT, () => {
  console.log(`Attendance system running at http://localhost:${PORT}`);
});
