import prisma from '../config/db.js';
import { convertCurrencySync } from '../utils/currency.js';

/**
 * 1. Get all wallets of the user (forces creation of default Cash Wallet if none exist)
 */
export const getWallets = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Fetch user's preferred currency
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true },
    });
    const prefCurrency = user?.preferredCurrency || 'INR';

    let wallets = await prisma.wallet.findMany({
      where: { userId },
      include: {
        transactions: {
          orderBy: [
            { date: 'asc' },
            { createdAt: 'asc' },
          ],
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // If no wallets, create singleton default non-deletable Cash Wallet
    if (wallets.length === 0) {
      const defaultCashWallet = await prisma.wallet.create({
        data: {
          userId,
          name: 'Cash Wallet',
          type: 'CASH',
          balance: 0.0,
        },
        include: {
          transactions: true,
        },
      });
      wallets = [defaultCashWallet];
    }

    // Dynamically calculate the wallet running balances in the user's preferred currency
    const calculatedWallets = wallets.map((wallet) => {
      let balance = 0.0;
      if (wallet.transactions && wallet.transactions.length > 0) {
        for (const tx of wallet.transactions) {
          const converted = convertCurrencySync(tx.amount, tx.currency, prefCurrency);
          if (tx.type === 'INCOME') {
            balance += converted;
          } else if (tx.type === 'EXPENSE') {
            balance -= converted;
          }
        }
      }
      return {
        ...wallet,
        balance: Math.round(balance * 100) / 100,
        transactions: undefined, // Do not send raw transactions array to frontend
      };
    });

    res.status(200).json(calculatedWallets);
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Create a new custom wallet
 */
export const createWallet = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name, type, balance } = req.body || {};

    if (!name || !type) {
      const error = new Error('Name and type are required');
      error.statusCode = 400;
      return next(error);
    }

    const typeUpper = type.toUpperCase();
    if (typeUpper !== 'CASH' && typeUpper !== 'BANK') {
      const error = new Error('Type must be either CASH or BANK');
      error.statusCode = 400;
      return next(error);
    }

    // Check duplicate name for the user
    const existing = await prisma.wallet.findFirst({
      where: {
        userId,
        name: {
          equals: name.trim(),
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      const error = new Error('A wallet with this name already exists');
      error.statusCode = 400;
      return next(error);
    }

    const newWallet = await prisma.wallet.create({
      data: {
        userId,
        name: name.trim(),
        type: typeUpper,
        balance: 0.0,
      },
    });

    res.status(201).json(newWallet);
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Update custom wallet details
 */
export const updateWallet = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, type, balance } = req.body || {};

    const wallet = await prisma.wallet.findUnique({
      where: { id },
    });

    if (!wallet) {
      const error = new Error('Wallet not found');
      error.statusCode = 404;
      return next(error);
    }

    if (wallet.userId !== userId) {
      const error = new Error('Not authorized to modify this wallet');
      error.statusCode = 403;
      return next(error);
    }

    // Protect "Cash Wallet" naming and type constraints
    if (wallet.name.toLowerCase() === 'cash wallet') {
      if (name && name.trim().toLowerCase() !== 'cash wallet') {
        const error = new Error('Cannot rename the default Cash Wallet');
        error.statusCode = 400;
        return next(error);
      }
      if (type && type.toUpperCase() !== 'CASH') {
        const error = new Error('Cannot change type of the default Cash Wallet');
        error.statusCode = 400;
        return next(error);
      }
    }

    if (name) {
      // Check duplicate name
      const duplicate = await prisma.wallet.findFirst({
        where: {
          userId,
          id: { not: id },
          name: {
            equals: name.trim(),
            mode: 'insensitive',
          },
        },
      });

      if (duplicate) {
        const error = new Error('A wallet with this name already exists');
        error.statusCode = 400;
        return next(error);
      }
    }

    const updated = await prisma.wallet.update({
      where: { id },
      data: {
        name: name ? name.trim() : undefined,
        type: type ? type.toUpperCase() : undefined,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Delete custom wallet
 */
export const deleteWallet = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const wallet = await prisma.wallet.findUnique({
      where: { id },
    });

    if (!wallet) {
      const error = new Error('Wallet not found');
      error.statusCode = 404;
      return next(error);
    }

    if (wallet.userId !== userId) {
      const error = new Error('Not authorized to delete this wallet');
      error.statusCode = 403;
      return next(error);
    }

    // Singleton "Cash Wallet" is non-deletable
    if (wallet.name.toLowerCase() === 'cash wallet') {
      const error = new Error('The default Cash Wallet is non-deletable');
      error.statusCode = 400;
      return next(error);
    }

    await prisma.wallet.delete({
      where: { id },
    });

    res.status(200).json({ message: 'Wallet deleted successfully' });
  } catch (error) {
    next(error);
  }
};
