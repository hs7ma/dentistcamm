const express = require('express');
const authRoutes = require('./auth.routes');
const climateRoutes = require('./climate.routes');
const irrigationRoutes = require('./irrigation.routes');
const adminRoutes = require('./admin.routes');
const greenhouseRoutes = require('./greenhouse.routes');
const aiRoutes = require('./ai.routes');

const router = express.Router();

router.use('/api/auth', authRoutes);
router.use('/api', climateRoutes);
router.use('/api', irrigationRoutes);
router.use('/api', adminRoutes);
router.use('/api', greenhouseRoutes);
router.use('/api/ai', aiRoutes);

router.get('/api/version', (_req, res) => {
  res.json({ version: '2026-04-27-v1' });
});

module.exports = router;