const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { isAvailable } = require('../db/supabase');
const { InventoryDB } = require('../db');

const router = express.Router();

let greenhouseLayout = {
  beds: [
    { bedId: 1, name: '\u062d\u0648\u0636 1', description: '\u0642\u0631\u064a\u0628 \u0645\u0646 \u0645\u062f\u062e\u0644 \u0627\u0644\u062f\u0641\u064a\u0626\u0629', plants: [{ id: 'tomato', name: '\u0637\u0645\u0627\u0637\u0645', category: '\u062e\u0636\u0627\u0631', variety: '\u0634\u064a\u0631\u064a', notes: '\u0631\u064a \u0643\u0645\u064a 8 \u0644\u062a\u0631/\u064a\u0648\u0645' }, { id: 'basil', name: '\u0631\u064a\u062d\u0627\u0646', category: '\u0623\u0639\u0634\u0627\u0628', notes: '\u062c\u0632\u0621 \u0645\u0638\u0644\u0644' }] },
    { bedId: 2, name: '\u062d\u0648\u0636 2', description: '\u0635\u0641 \u0623\u0645\u0627\u0645\u064a', plants: [{ id: 'cucumber', name: '\u062e\u064a\u0627\u0631', category: '\u062e\u0636\u0627\u0631', notes: '\u062a\u062f\u0639\u064a\u0645 \u0639\u0645\u0648\u062f\u064a' }, { id: 'lettuce', name: '\u062e\u0633', category: '\u0648\u0631\u0642\u064a\u0627\u062a' }] },
    { bedId: 3, name: '\u062d\u0648\u0636 3', description: '\u0635\u0641 \u0623\u0645\u0627\u0645\u064a', plants: [{ id: 'pepper', name: '\u0641\u0644\u0641\u0644 \u062d\u0644\u0648', category: '\u062e\u0636\u0627\u0631' }] },
    { bedId: 4, name: '\u062d\u0648\u0636 4', description: '\u0635\u0641 \u0623\u0645\u0627\u0645\u064a', plants: [{ id: 'chili', name: '\u0641\u0644\u0641\u0644 \u062d\u0627\u0631', category: '\u062e\u0636\u0627\u0631' }, { id: 'mint', name: '\u0646\u0639\u0646\u0627\u0639', category: '\u0623\u0639\u0634\u0627\u0628' }] },
    { bedId: 5, name: '\u062d\u0648\u0636 5', description: '\u0635\u0641 \u062e\u0644\u0641\u064a', plants: [{ id: 'strawberry', name: '\u0641\u0631\u0627\u0648\u0644\u0629', category: '\u0641\u0648\u0627\u0643\u0647' }] },
    { bedId: 6, name: '\u062d\u0648\u0636 6', description: '\u0635\u0641 \u062e\u0644\u0641\u064a', plants: [{ id: 'eggplant', name: '\u0628\u0627\u0630\u0646\u062c\u0627\u0646', category: '\u062e\u0636\u0627\u0631' }] },
    { bedId: 7, name: '\u062d\u0648\u0636 7', description: '\u0632\u0627\u0648\u064a\u0629', plants: [{ id: 'rosemary', name: '\u0625\u0643\u0644\u064a\u0644 \u0627\u0644\u062c\u0628\u0644', category: '\u0623\u0639\u0634\u0627\u0628' }] },
    { bedId: 8, name: '\u062d\u0648\u0636 8', description: '\u0632\u0627\u0648\u064a\u0629 \u0642\u0631\u0628 \u062e\u0632\u0627\u0646 \u0627\u0644\u0645\u0627\u0621', plants: [{ id: 'tomato', name: '\u0637\u0645\u0627\u0637\u0645', category: '\u062e\u0636\u0627\u0631', variety: '\u062d\u0642\u0644\u064a\u0629' }, { id: 'coriander', name: '\u0643\u0632\u0628\u0631\u0629', category: '\u0623\u0639\u0634\u0627\u0628' }] },
  ],
};

let inventory = {
  plants: [
    { id: 'tomato', name: '\u0637\u0645\u0627\u0637\u0645', category: '\u062e\u0636\u0627\u0631', beds: [1, 8] },
    { id: 'cucumber', name: '\u062e\u064a\u0627\u0631', category: '\u062e\u0636\u0627\u0631', beds: [2] },
    { id: 'lettuce', name: '\u062e\u0633', category: '\u0648\u0631\u0642\u064a\u0627\u062a', beds: [2] },
    { id: 'basil', name: '\u0631\u064a\u062d\u0627\u0646', category: '\u0623\u0639\u0634\u0627\u0628', beds: [1] },
    { id: 'mint', name: '\u0646\u0639\u0646\u0627\u0639', category: '\u0623\u0639\u0634\u0627\u0628', beds: [4] },
    { id: 'strawberry', name: '\u0641\u0631\u0627\u0648\u0644\u0629', category: '\u0641\u0648\u0627\u0643\u0647', beds: [5] },
  ],
  fertilizers: [
    { id: 'npk20', name: 'NPK 20-20-20', type: '\u0633\u0645\u0627\u062f', quantity: 5, unit: 'kg', minThreshold: 2, notes: '\u0644\u0644\u0637\u0645\u0627\u0637\u0645 \u0648\u0627\u0644\u062e\u064a\u0627\u0631' },
    { id: 'calcium', name: '\u0643\u0627\u0644\u0633\u064a\u0648\u0645 \u0633\u0627\u0626\u0644', type: '\u0645\u063a\u0630\u064a', quantity: 3, unit: 'L', minThreshold: 1, notes: '\u0645\u0646\u0639 \u062a\u0639\u0641\u0646 \u0627\u0644\u0637\u0631\u0641 \u0627\u0644\u0632\u0647\u0631\u064a' },
    { id: 'iron', name: '\u062d\u062f\u064a\u062f \u0645\u062e\u0644\u0628\u0627\u062a', type: '\u0645\u063a\u0630\u064a', quantity: 1.5, unit: 'L', minThreshold: 1 },
    { id: 'pesticide1', name: '\u0645\u0628\u064a\u062f \u0641\u0637\u0631\u064a', type: '\u0645\u0628\u064a\u062f', quantity: 0.8, unit: 'L', minThreshold: 0.5 },
  ],
};

router.get('/greenhouse/layout', authenticateToken, (_req, res) => {
  res.json({ ok: true, layout: greenhouseLayout });
});

router.put('/greenhouse/layout', authenticateToken, (req, res, next) => {
  try {
    const { layout } = req.body || {};
    if (!layout || !Array.isArray(layout.beds)) {
      return res.status(400).json({ ok: false, error: '"layout.beds" array is required' });
    }
    for (const bed of layout.beds) {
      if (!bed || typeof bed !== 'object' || typeof bed.bedId !== 'number') {
        return res.status(400).json({ ok: false, error: 'Each bed must have a numeric "bedId"' });
      }
    }
    greenhouseLayout = layout;
    res.json({ ok: true, layout: greenhouseLayout });
  } catch (error) {
    next(error);
  }
});

router.get('/inventory', authenticateToken, (_req, res) => {
  res.json({ ok: true, inventory });
});

router.put('/inventory', authenticateToken, (req, res, next) => {
  try {
    const { plants, fertilizers } = req.body || {};
    if (plants && Array.isArray(plants)) inventory.plants = plants;
    if (fertilizers && Array.isArray(fertilizers)) inventory.fertilizers = fertilizers;
    res.json({ ok: true, inventory });
  } catch (error) {
    next(error);
  }
});

module.exports = router;