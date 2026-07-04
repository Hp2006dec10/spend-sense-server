import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  getWallets,
  createWallet,
  updateWallet,
  deleteWallet,
} from '../controllers/walletController.js';

const router = express.Router();

// Apply auth protection to all wallet routes
router.use(protect);

router.get('/', getWallets);
router.post('/', createWallet);
router.put('/:id', updateWallet);
router.delete('/:id', deleteWallet);

export default router;
