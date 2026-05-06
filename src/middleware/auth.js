const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ ok: false, error: '\u063a\u064a\u0631 \u0645\u0635\u0631\u062d - \u064a\u0631\u062c\u0649 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644' });
  }

  jwt.verify(token, config.jwt.secret, (err, user) => {
    if (err) {
      return res.status(403).json({ ok: false, error: '\u062c\u0644\u0633\u0629 \u0645\u0646\u062a\u0647\u064a\u0629 - \u064a\u0631\u062c\u0649 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0645\u062c\u062f\u062f\u0627\u064b' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '\u063a\u064a\u0631 \u0645\u0635\u0631\u062d - \u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0627\u0644\u0645\u062f\u064a\u0631 \u0645\u0637\u0644\u0648\u0628\u0629' });
  }
  next();
}

const loginAttempts = new Map();
const LOGIN_RATE_LIMIT = { maxAttempts: 5, windowMs: 60000 };

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now - record.firstAttempt > LOGIN_RATE_LIMIT.windowMs) {
      loginAttempts.delete(ip);
    }
  }
}, 60000).unref();

function checkLoginRateLimit(req, res, next) {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.ip
    || req.connection.remoteAddress;
  const now = Date.now();
  const record = loginAttempts.get(clientIp);
  if (!record || now - record.firstAttempt > LOGIN_RATE_LIMIT.windowMs) {
    loginAttempts.set(clientIp, { count: 1, firstAttempt: now });
    return next();
  }
  record.count++;
  if (record.count > LOGIN_RATE_LIMIT.maxAttempts) {
    return res.status(429).json({ ok: false, error: '\u0645\u062d\u0627\u0648\u0644\u0627\u062a \u0643\u062b\u064a\u0631\u0629 - \u0627\u0646\u062a\u0638\u0631 \u062f\u0642\u064a\u0642\u0629' });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin, checkLoginRateLimit };