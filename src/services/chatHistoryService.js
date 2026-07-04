import prisma from '../config/db.js';

/**
 * Creates a new chat session for a user.
 * @param {string} userId - ID of the user.
 * @param {string} [title] - Optional title of the session.
 * @returns {Promise<object>} The created ChatSession.
 */
export const createSession = async (userId, title = 'New Conversation') => {
  return await prisma.chatSession.create({
    data: {
      userId,
      title,
    },
  });
};

/**
 * Lists all chat sessions for a user, sorted by most recent.
 * @param {string} userId - ID of the user.
 * @returns {Promise<Array>} List of chat sessions.
 */
export const listSessions = async (userId) => {
  return await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
};

/**
 * Deletes a chat session if it belongs to the user.
 * @param {string} sessionId - ID of the session.
 * @param {string} userId - ID of the user.
 * @returns {Promise<object>} The deleted session.
 */
export const deleteSession = async (sessionId, userId) => {
  // Ensure ownership
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    throw new Error('Chat session not found or access denied');
  }

  return await prisma.chatSession.delete({
    where: { id: sessionId },
  });
};

/**
 * Adds a message to an existing session.
 * Updates the session's updatedAt timestamp.
 * @param {string} sessionId - ID of the session.
 * @param {string} role - Message sender role ('user' or 'model').
 * @param {string} content - Message content.
 * @returns {Promise<object>} The created ChatMessage.
 */
export const addMessage = async (sessionId, role, content) => {
  return await prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.create({
      data: {
        sessionId,
        role,
        content,
      },
    });

    // Update session timestamp
    await tx.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return message;
  });
};

/**
 * Retrieves the message history for a session, formatted for LangChain.
 * @param {string} sessionId - ID of the session.
 * @param {string} userId - ID of the user.
 * @returns {Promise<Array>} Array of messages.
 */
export const getSessionHistory = async (sessionId, userId, limit = undefined) => {
  // Verify session belongs to user
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
    include: {
      messages: {
        orderBy: { createdAt: limit ? 'desc' : 'asc' },
        take: limit,
      },
    },
  });

  if (!session) {
    throw new Error('Chat session not found or access denied');
  }

  if (limit) {
    return session.messages.reverse();
  }
  return session.messages;
};

export default {
  createSession,
  listSessions,
  deleteSession,
  addMessage,
  getSessionHistory,
};
