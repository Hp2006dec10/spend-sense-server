import prisma from '../config/db.js';
import { chatWithAgent } from '../services/agentService.js';
import {
  createSession,
  listSessions,
  deleteSession as deleteDbSession,
  addMessage,
  getSessionHistory,
} from '../services/chatHistoryService.js';

/**
 * Send a message to the AI agent.
 * Handles auto-session creation, message logging, and response persistence.
 */
export const sendMessage = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const customApiKey = req.headers['x-gemini-api-key'] || null;
    const { message, sessionId, createNewSession } = req.body || {};

    // Check if user has AI enabled
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAiEnabled: true }
    });

    if (!user || !user.isAiEnabled) {
      const error = new Error('AI agent features are disabled for this account.');
      error.statusCode = 403;
      return next(error);
    }

    if (!message || !message.trim()) {
      const error = new Error('Message is required');
      error.statusCode = 400;
      return next(error);
    }

    console.log(message);

    let session;

    if (sessionId) {
      session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
      });
      if (!session) {
        const error = new Error('Chat session not found');
        error.statusCode = 404;
        return next(error);
      }
    } else if (createNewSession) {
      const defaultTitle = `Chat - ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
      session = await createSession(userId, defaultTitle);
    } else {
      // Find the most recent active session
      const sessions = await listSessions(userId);
      if (sessions.length > 0) {
        session = sessions[0];
      } else {
        const defaultTitle = `Chat - ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
        session = await createSession(userId, defaultTitle);
      }
    }

    // 1. Fetch recent message history (last 15 messages) for the session to speed up LLM request
    const messages = await getSessionHistory(session.id, userId, 15);

    // 2. Format history for LangChain [ { role: 'user'|'model', content: string } ]
    const formattedHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 3. Save the new user message to DB
    await addMessage(session.id, 'user', message.trim());

    // 4. Run the AI agent ReAct loop
    const reply = await chatWithAgent(userId, message.trim(), formattedHistory, customApiKey);

    // 5. Save the agent reply to DB
    await addMessage(session.id, 'model', reply);

    // 6. Return response to client
    res.status(200).json({
      reply,
      sessionId: session.id,
      sessionTitle: session.title,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all chat sessions for the authenticated user.
 */
export const getSessions = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const sessions = await listSessions(userId);
    res.status(200).json(sessions);
  } catch (error) {
    next(error);
  }
};

/**
 * Get messages inside a specific chat session.
 */
export const getSessionMessages = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    const messages = await getSessionHistory(sessionId, userId);
    res.status(200).json(messages);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a chat session.
 */
export const deleteSession = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    await deleteDbSession(sessionId, userId);
    res.status(200).json({ message: 'Chat session deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Rename a chat session.
 */
export const renameSession = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;
    const { title } = req.body || {};

    if (!title || !title.trim()) {
      const error = new Error('Title is required');
      error.statusCode = 400;
      return next(error);
    }

    // Ensure session exists and is owned by the user
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      const error = new Error('Chat session not found or access denied');
      error.statusCode = 404;
      return next(error);
    }

    const updated = await prisma.chatSession.update({
      where: { id: sessionId },
      data: { title: title.trim() },
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

export default {
  sendMessage,
  getSessions,
  getSessionMessages,
  deleteSession,
  renameSession,
};
