import { Router } from 'express';
import {
  signup,
  login,
  tokenRefresh,
  logout,
  getProfile,
  updatePreferredCurrency,
  updateAiOptInStatus,
  gatewayBypass,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);
router.post('/refresh', tokenRefresh);
router.post('/gateway-bypass', gatewayBypass);

// Protected routes
router.post('/logout', protect, logout);
router.get('/profile', protect, getProfile);
router.put('/profile/currency', protect, updatePreferredCurrency);
router.put('/profile/ai-toggle', protect, updateAiOptInStatus);

export default router;
