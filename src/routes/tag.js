import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  getTags,
  createTag,
  deleteTag,
  updateTag,
} from '../controllers/tagController.js';

const router = express.Router();

// Apply auth protection to all tag routes
router.use(protect);

router.get('/', getTags);
router.post('/', createTag);
router.put('/:id', updateTag);
router.delete('/:id', deleteTag);

export default router;
