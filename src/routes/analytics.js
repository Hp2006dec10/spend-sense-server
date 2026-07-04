import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  getSummary,
  getPieChart,
  getMonthlyTrends,
} from '../controllers/analyticsController.js';

const router = express.Router();

// Apply auth protection to all analytics routes
router.use(protect);

router.get('/summary', getSummary);
router.get('/pie-chart', getPieChart);
router.get('/trends', getMonthlyTrends);

export default router;
