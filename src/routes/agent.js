import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  sendMessage,
  getSessions,
  getSessionMessages,
  deleteSession,
  renameSession,
} from '../controllers/agentController.js';

const router = express.Router();

// All agent endpoints require authentication
router.use(protect);

router.post('/chat', sendMessage);
router.get('/sessions', getSessions);
router.get('/sessions/:sessionId/messages', getSessionMessages);
router.delete('/sessions/:sessionId', deleteSession);
router.put('/sessions/:sessionId', renameSession);

export default router;

