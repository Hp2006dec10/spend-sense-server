import prisma from '../config/db.js';

/**
 * 1. Get all categories (system default + user custom)
 */
export const getCategories = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Check if this user has any categories in the db
    const count = await prisma.category.count({
      where: { userId },
    });

    if (count === 0) {
      // Precreate default categories for this user
      const defaultCategories = [
        // EXPENSES
        { name: 'Food & Dining', type: 'EXPENSE', color: '#FF7A59', icon: 'fast-food' },
        { name: 'Transport / Travel', type: 'EXPENSE', color: '#4A90E2', icon: 'car' },
        { name: 'Shopping', type: 'EXPENSE', color: '#FFB900', icon: 'basket' },
        { name: 'Entertainment', type: 'EXPENSE', color: '#9B51E0', icon: 'game-controller' },
        { name: 'Utilities', type: 'EXPENSE', color: '#27AE60', icon: 'bulb' },
        { name: 'Health & Fitness', type: 'EXPENSE', color: '#EB5757', icon: 'heart' },
        { name: 'Rent / Housing', type: 'EXPENSE', color: '#F2994A', icon: 'home' },
        { name: 'Miscellaneous', type: 'EXPENSE', color: '#828282', icon: 'help' },

        // INCOMES
        { name: 'Salary', type: 'INCOME', color: '#2196F3', icon: 'cash' },
        { name: 'Freelance / Side Hustle', type: 'INCOME', color: '#9C27B0', icon: 'briefcase' },
        { name: 'Investments', type: 'INCOME', color: '#4CAF50', icon: 'trending-up' },
        { name: 'Gifts', type: 'INCOME', color: '#E91E63', icon: 'gift' },
        { name: 'Refund', type: 'INCOME', color: '#FF9800', icon: 'refresh' },
        { name: 'Other Income', type: 'INCOME', color: '#607D8B', icon: 'wallet' },
      ];

      await prisma.category.createMany({
        data: defaultCategories.map((c) => ({
          userId,
          name: c.name,
          type: c.type,
          color: c.color,
          icon: c.icon,
        })),
      });
    }

    const categories = await prisma.category.findMany({
      where: { userId },
      orderBy: {
        name: 'asc',
      },
    });

    res.status(200).json(categories);
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Create a custom category
 */
export const createCategory = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name, type, color, icon } = req.body || {};

    if (!name || !type) {
      const error = new Error('Name and type are required');
      error.statusCode = 400;
      return next(error);
    }

    const typeUpper = type.toUpperCase();
    if (typeUpper !== 'EXPENSE' && typeUpper !== 'INCOME') {
      const error = new Error('Type must be either EXPENSE or INCOME');
      error.statusCode = 400;
      return next(error);
    }

    // Check duplicate name for the same user
    const existing = await prisma.category.findFirst({
      where: {
        userId,
        name: {
          equals: name,
          mode: 'insensitive',
        },
        type: typeUpper,
      },
    });

    if (existing) {
      const error = new Error('A custom category with this name already exists');
      error.statusCode = 400;
      return next(error);
    }

    // Also check duplicate name in system categories
    const existingSystem = await prisma.category.findFirst({
      where: {
        userId: null,
        name: {
          equals: name,
          mode: 'insensitive',
        },
        type: typeUpper,
      },
    });

    if (existingSystem) {
      const error = new Error('A system category with this name already exists');
      error.statusCode = 400;
      return next(error);
    }

    const newCategory = await prisma.category.create({
      data: {
        userId,
        name,
        type: typeUpper,
        color: color || '#4A90E2',
        icon: icon || 'wallet',
      },
    });

    res.status(201).json(newCategory);
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Update custom category
 */
export const updateCategory = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, color, icon } = req.body || {};

    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      const error = new Error('Category not found');
      error.statusCode = 404;
      return next(error);
    }

    if (category.userId !== userId) {
      const error = new Error('Not authorized to modify this category');
      error.statusCode = 403;
      return next(error);
    }

    if (name) {
      // Check duplicate name
      const duplicate = await prisma.category.findFirst({
        where: {
          userId,
          id: { not: id },
          name: {
            equals: name,
            mode: 'insensitive',
          },
          type: category.type,
        },
      });

      if (duplicate) {
        const error = new Error('A custom category with this name already exists');
        error.statusCode = 400;
        return next(error);
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: name || undefined,
        color: color || undefined,
        icon: icon || undefined,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Delete custom category (deletes transactions due to cascade delete)
 */
export const deleteCategory = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      const error = new Error('Category not found');
      error.statusCode = 404;
      return next(error);
    }

    if (category.userId === null) {
      const error = new Error('Cannot delete system default categories');
      error.statusCode = 403;
      return next(error);
    }

    if (category.userId !== userId) {
      const error = new Error('Not authorized to delete this category');
      error.statusCode = 403;
      return next(error);
    }

    await prisma.category.delete({
      where: { id },
    });

    res.status(200).json({ message: 'Category deleted successfully and all associated transactions removed' });
  } catch (error) {
    next(error);
  }
};
