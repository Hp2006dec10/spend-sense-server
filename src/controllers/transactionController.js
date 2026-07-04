import prisma from '../config/db.js';

/**
 * 1. Get transactions with advanced filters and search
 */
export const getTransactions = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const {
      type,
      categoryId,
      tagId,
      startDate,
      endDate,
      search,
      currency,
      walletId,
      page,
      limit,
      paymentMethod,
      minAmount,
      maxAmount,
    } = req.query || {};

    // Build Prisma query filter
    const where = { userId };

    if (type) {
      where.type = type.toUpperCase();
    }

    if (categoryId) {
      const ids = categoryId.split(',').filter(Boolean);
      if (ids.length > 0) {
        where.categoryId = { in: ids };
      }
    }

    if (walletId) {
      const ids = walletId.split(',').filter(Boolean);
      if (ids.length > 0) {
        where.walletId = { in: ids };
      }
    }

    if (paymentMethod) {
      const methods = paymentMethod.split(',').filter(Boolean);
      if (methods.length > 0) {
        where.paymentMethod = { in: methods };
      }
    }

    if (currency) {
      where.currency = currency.toUpperCase();
    }

    // Filter by tag IDs (multi-select)
    if (tagId) {
      const ids = tagId.split(',').filter(Boolean);
      if (ids.length > 0) {
        where.tags = {
          some: {
            id: { in: ids },
          },
        };
      }
    }

    // Filter by amount range
    if (minAmount || maxAmount) {
      where.amount = {};
      if (minAmount) {
        where.amount.gte = parseFloat(minAmount);
      }
      if (maxAmount) {
        where.amount.lte = parseFloat(maxAmount);
      }
    }

    // Filter by date range
    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate);
      }
      if (endDate) {
        where.date.lte = new Date(endDate);
      }
    }

    // Search filter: search notes, category name, tag names, payment method
    if (search) {
      const searchLower = search.trim();
      where.OR = [
        {
          notes: {
            contains: searchLower,
            mode: 'insensitive',
          },
        },
        {
          paymentMethod: {
            contains: searchLower,
            mode: 'insensitive',
          },
        },
        {
          category: {
            name: {
              contains: searchLower,
              mode: 'insensitive',
            },
          },
        },
        {
          tags: {
            some: {
              name: {
                contains: searchLower,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        category: true,
        tags: true,
        wallet: true,
      },
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' },
      ],
      skip,
      take: limitNum,
    });

    const totalCount = await prisma.transaction.count({ where });

    res.status(200).json({
      transactions,
      hasMore: skip + transactions.length < totalCount,
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Create transaction (with inline tag auto-creation)
 */
export const createTransaction = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const {
      name,
      type,
      amount,
      currency,
      categoryId,
      notes,
      paymentMethod,
      date,
      tags, // Array of strings (tag names)
      walletId,
    } = req.body || {};

    if (!name || !name.trim()) {
      const error = new Error('Transaction name is required');
      error.statusCode = 400;
      return next(error);
    }

    if (!type || amount === undefined || !categoryId) {
      const error = new Error('Type, amount, and category are required');
      error.statusCode = 400;
      return next(error);
    }

    const typeUpper = type.toUpperCase();
    if (typeUpper !== 'EXPENSE' && typeUpper !== 'INCOME') {
      const error = new Error('Type must be either EXPENSE or INCOME');
      error.statusCode = 400;
      return next(error);
    }

    // Resolve wallet and validate compatibility with paymentMethod
    let wallet = null;
    if (walletId) {
      wallet = await prisma.wallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        const error = new Error('Wallet not found');
        error.statusCode = 404;
        return next(error);
      }

      const pm = (paymentMethod || 'CASH').toUpperCase();
      if (wallet.type === 'CASH' && pm !== 'CASH') {
        const error = new Error('Cash wallets only support Cash payment method');
        error.statusCode = 400;
        return next(error);
      }
      if (wallet.type === 'BANK' && pm === 'CASH') {
        const error = new Error('Bank wallets do not support Cash payment method');
        error.statusCode = 400;
        return next(error);
      }
    }

    // Resolve category
    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        OR: [{ userId: null }, { userId }],
      },
    });

    if (!category) {
      const error = new Error('Category not found');
      error.statusCode = 404;
      return next(error);
    }

    // Resolve or create tags inline
    const resolvedTags = [];
    if (Array.isArray(tags) && tags.length > 0) {
      for (const tagName of tags) {
        const cleanName = tagName.trim();
        if (!cleanName) continue;

        // Check if tag exists (case-insensitive) for this user
        let tagRecord = await prisma.tag.findFirst({
          where: {
            userId,
            name: {
              equals: cleanName,
              mode: 'insensitive',
            },
          },
        });

        // Create tag if it doesn't exist
        if (!tagRecord) {
          tagRecord = await prisma.tag.create({
            data: {
              userId,
              name: cleanName,
              color: '#A0AEC0', // default grey
            },
          });
        }
        resolvedTags.push({ id: tagRecord.id });
      }
    }

    const transaction = await prisma.$transaction(async (tx) => {
      // 1. Create Transaction
      const newTx = await tx.transaction.create({
        data: {
          userId,
          name: name.trim(),
          type: typeUpper,
          amount: parseFloat(amount),
          currency: currency ? currency.toUpperCase() : 'INR',
          categoryId,
          notes: notes || null,
          paymentMethod: paymentMethod || 'CASH',
          walletId: walletId || null,
          date: date ? new Date(date) : new Date(),
          tags: {
            connect: resolvedTags,
          },
        },
        include: {
          category: true,
          tags: true,
          wallet: true,
        },
      });

      // 2. Adjust wallet running balance if walletId is present
      if (walletId) {
        const parsedAmount = parseFloat(amount);
        const adjustment = typeUpper === 'INCOME' ? parsedAmount : -parsedAmount;
        await tx.wallet.update({
          where: { id: walletId },
          data: {
            balance: {
              increment: adjustment,
            },
          },
        });
      }

      return newTx;
    });

    res.status(201).json(transaction);
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Update transaction
 */
export const updateTransaction = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const {
      name,
      type,
      amount,
      currency,
      categoryId,
      notes,
      paymentMethod,
      date,
      tags, // Array of strings (tag names)
      walletId,
    } = req.body || {};

    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      const error = new Error('Transaction not found');
      error.statusCode = 404;
      return next(error);
    }

    if (transaction.userId !== userId) {
      const error = new Error('Not authorized to update this transaction');
      error.statusCode = 403;
      return next(error);
    }

    // Determine target payment method for compatibility checks
    const targetPaymentMethod = paymentMethod !== undefined ? paymentMethod : transaction.paymentMethod;
    const targetWalletId = walletId !== undefined ? walletId : transaction.walletId;

    if (targetWalletId) {
      const wallet = await prisma.wallet.findFirst({
        where: { id: targetWalletId, userId },
      });

      if (!wallet) {
        const error = new Error('Wallet not found');
        error.statusCode = 404;
        return next(error);
      }

      const pm = (targetPaymentMethod || 'CASH').toUpperCase();
      if (wallet.type === 'CASH' && pm !== 'CASH') {
        const error = new Error('Cash wallets only support Cash payment method');
        error.statusCode = 400;
        return next(error);
      }
      if (wallet.type === 'BANK' && pm === 'CASH') {
        const error = new Error('Bank wallets do not support Cash payment method');
        error.statusCode = 400;
        return next(error);
      }
    }

    // If changing category, verify category exists
    if (categoryId && categoryId !== transaction.categoryId) {
      const category = await prisma.category.findFirst({
        where: {
          id: categoryId,
          OR: [{ userId: null }, { userId }],
        },
      });

      if (!category) {
        const error = new Error('Category not found');
        error.statusCode = 404;
        return next(error);
      }
    }

    // Resolve tags if provided
    let tagUpdate = undefined;
    if (Array.isArray(tags)) {
      const resolvedTags = [];
      for (const tagName of tags) {
        const cleanName = tagName.trim();
        if (!cleanName) continue;

        let tagRecord = await prisma.tag.findFirst({
          where: {
            userId,
            name: {
              equals: cleanName,
              mode: 'insensitive',
            },
          },
        });

        if (!tagRecord) {
          tagRecord = await prisma.tag.create({
            data: {
              userId,
              name: cleanName,
              color: '#A0AEC0',
            },
          });
        }
        resolvedTags.push({ id: tagRecord.id });
      }
      tagUpdate = {
        set: resolvedTags, // Replaces current connections with the new resolved tag set
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Revert old transaction from old wallet if existed
      if (transaction.walletId) {
        const oldAmount = transaction.amount;
        const revertAdjustment = transaction.type === 'INCOME' ? -oldAmount : oldAmount;
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: {
            balance: {
              increment: revertAdjustment,
            },
          },
        });
      }

      // 2. Update Transaction
      const updatedTx = await tx.transaction.update({
        where: { id },
        data: {
          name: name !== undefined ? name.trim() : undefined,
          type: type ? type.toUpperCase() : undefined,
          amount: amount !== undefined ? parseFloat(amount) : undefined,
          currency: currency ? currency.toUpperCase() : undefined,
          categoryId: categoryId || undefined,
          notes: notes !== undefined ? notes : undefined,
          paymentMethod: paymentMethod || undefined,
          walletId: walletId !== undefined ? (walletId || null) : undefined,
          date: date ? new Date(date) : undefined,
          tags: tagUpdate,
        },
        include: {
          category: true,
          tags: true,
          wallet: true,
        },
      });

      // 3. Apply updated transaction to new wallet if present
      if (updatedTx.walletId) {
        const newAmount = updatedTx.amount;
        const newAdjustment = updatedTx.type === 'INCOME' ? newAmount : -newAmount;
        await tx.wallet.update({
          where: { id: updatedTx.walletId },
          data: {
            balance: {
              increment: newAdjustment,
            },
          },
        });
      }

      return updatedTx;
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Delete transaction
 */
export const deleteTransaction = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      const error = new Error('Transaction not found');
      error.statusCode = 404;
      return next(error);
    }

    if (transaction.userId !== userId) {
      const error = new Error('Not authorized to delete this transaction');
      error.statusCode = 403;
      return next(error);
    }

    await prisma.$transaction(async (tx) => {
      // Revert wallet balance if walletId existed
      if (transaction.walletId) {
        const amount = transaction.amount;
        const adjustment = transaction.type === 'INCOME' ? -amount : amount;
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: {
            balance: {
              increment: adjustment,
            },
          },
        });
      }

      await tx.transaction.delete({
        where: { id },
      });
    });

    res.status(200).json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    next(error);
  }
};
