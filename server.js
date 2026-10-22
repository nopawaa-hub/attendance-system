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
