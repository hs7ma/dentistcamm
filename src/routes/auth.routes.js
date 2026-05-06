const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { authenticateToken, requireAdmin, checkLoginRateLimit } = require('../middleware/auth');
const UsersService = require('../services/users.service');

const router = express.Router();

router.post('/login', checkLoginRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0648\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631' });
    }
    const result = await UsersService.login(username, password);
    if (!result.ok) {
      return res.status(401).json(result);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/verify', authenticateToken, (req, res) => {
  res.json({ ok: true, user: req.user });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;