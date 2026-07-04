import prisma from '../config/db.js';

/**
 * Retrieves all memories stored for a user, sorted by updatedAt.
 * @param {string} userId - ID of the user.
 * @returns {Promise<Array>} List of user memories.
 */
export const getAgentMemories = async (userId) => {
  try {
    return await prisma.agentMemory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  } catch (error) {
    console.error('Error fetching agent memories:', error);
    return [];
  }
};

/**
 * Saves (creates or updates) an agent memory record.
 * @param {string} userId - ID of the user.
 * @param {string} type - Memory type ("PREFERENCE", "HABIT", "RULE").
 * @param {string} key - Unique key identifier for the memory.
 * @param {object} payload - Dynamic JSON metadata properties.
 * @returns {Promise<object>} The upserted memory record.
 */
export const saveAgentMemory = async (userId, type, key, payload) => {
  const typeUpper = type.toUpperCase();
  const cleanKey = key.trim().toLowerCase();

  return await prisma.agentMemory.upsert({
    where: {
      userId_key_type: {
        userId,
        key: cleanKey,
        type: typeUpper,
      },
    },
    update: {
      payload,
    },
    create: {
      userId,
      type: typeUpper,
      key: cleanKey,
      payload,
    },
  });
};

/**
 * Deletes a specific agent memory.
 * @param {string} userId - ID of the user.
 * @param {string} type - Memory type.
 * @param {string} key - Unique key.
 * @returns {Promise<object>} The deleted record.
 */
export const deleteAgentMemory = async (userId, type, key) => {
  const typeUpper = type.toUpperCase();
  const cleanKey = key.trim().toLowerCase();

  return await prisma.agentMemory.delete({
    where: {
      userId_key_type: {
        userId,
        key: cleanKey,
        type: typeUpper,
      },
    },
  });
};

export default {
  getAgentMemories,
  saveAgentMemory,
  deleteAgentMemory,
};
