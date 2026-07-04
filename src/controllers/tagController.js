import prisma from '../config/db.js';

/**
 * 1. Get all tags of the logged-in user
 */
export const getTags = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const tags = await prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });

    res.status(200).json(tags);
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Create custom tag
 */
export const createTag = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name, color } = req.body || {};

    if (!name) {
      const error = new Error('Tag name is required');
      error.statusCode = 400;
      return next(error);
    }

    const cleanName = name.trim();

    // Check if tag already exists for this user (case-insensitive)
    const existing = await prisma.tag.findFirst({
      where: {
        userId,
        name: {
          equals: cleanName,
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      const error = new Error('A tag with this name already exists');
      error.statusCode = 400;
      return next(error);
    }

    const tag = await prisma.tag.create({
      data: {
        userId,
        name: cleanName,
        color: color || '#A0AEC0',
      },
    });

    res.status(201).json(tag);
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Delete tag
 */
export const deleteTag = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const tag = await prisma.tag.findUnique({
      where: { id },
    });

    if (!tag) {
      const error = new Error('Tag not found');
      error.statusCode = 404;
      return next(error);
    }

    if (tag.userId !== userId) {
      const error = new Error('Not authorized to delete this tag');
      error.statusCode = 403;
      return next(error);
    }

    // Prisma automatically handles deletion in junction table and leaves Transaction records intact
    await prisma.tag.delete({
      where: { id },
    });

    res.status(200).json({ message: 'Tag deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Update custom tag (Rename/Recolor)
 */
export const updateTag = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, color } = req.body || {};

    const tag = await prisma.tag.findUnique({
      where: { id },
    });

    if (!tag) {
      const error = new Error('Tag not found');
      error.statusCode = 404;
      return next(error);
    }

    if (tag.userId !== userId) {
      const error = new Error('Not authorized to update this tag');
      error.statusCode = 403;
      return next(error);
    }

    const cleanName = name ? name.trim() : undefined;

    if (cleanName) {
      // Check if tag already exists for this user with same name (and is a different record)
      const existing = await prisma.tag.findFirst({
        where: {
          userId,
          id: { not: id },
          name: {
            equals: cleanName,
            mode: 'insensitive',
          },
        },
      });

      if (existing) {
        const error = new Error('A tag with this name already exists');
        error.statusCode = 400;
        return next(error);
      }
    }

    const updated = await prisma.tag.update({
      where: { id },
      data: {
        name: cleanName,
        color,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};
