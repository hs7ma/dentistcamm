const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const UsersService = require('../services/users.service');

const router = express.Router();

router.get('/admin/users', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const result = await UsersService.getAll();
    res.json({ ok: true, users: result });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/users', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, userType, department, stage, section } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0627\u0633\u0645' });
    }
    if (!userType || !['student', 'staff'].includes(userType)) {
      return res.status(400).json({ ok: false, error: '\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0646\u0648\u0639 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 (\u0637\u0627\u0644\u0628 \u0623\u0648 \u0645\u0646\u062a\u0633\u0628)' });
    }
    if (!department || !department.trim()) {
      return res.status(400).json({ ok: false, error: '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0642\u0633\u0645' });
    }
    if (userType === 'student') {
      if (!stage || !stage.trim()) {
        return res.status(400).json({ ok: false, error: '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0645\u0631\u062d\u0644\u0629 \u0644\u0644\u0637\u0627\u0644\u0628' });
      }
      if (!section || !section.trim()) {
        return res.status(400).json({ ok: false, error: '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0634\u0639\u0628\u0629 \u0644\u0644\u0637\u0627\u0644\u0628' });
      }
    }
    const result = await UsersService.create({ name, userType, department, stage, section });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put('/admin/users/:userId', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await UsersService.update(userId, req.body || {});
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/admin/users/:userId', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await UsersService.delete(userId);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;