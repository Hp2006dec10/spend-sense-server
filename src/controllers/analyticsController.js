import prisma from '../config/db.js';
import { convertCurrencySync } from '../utils/currency.js';

/**
 * Helper to get user's preferred currency
 */
const getUserPreferredCurrency = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferredCurrency: true },
  });
  return user?.preferredCurrency || 'INR';
};

/**
 * 1. Get financial summaries (Balance, Income, Expense, converted to preferred currency)
 */
export const getSummary = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const prefCurrency = await getUserPreferredCurrency(userId);

    // Fetch all transactions for this user sorted by date ascending
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    let totalIncome = 0;
    let totalExpense = 0;
    let monthlyIncome = 0;
    let monthlyExpense = 0;

    for (const tx of transactions) {
      // Convert amount to preferred currency
      const convertedAmount = convertCurrencySync(tx.amount, tx.currency, prefCurrency);

      const txDate = new Date(tx.date);
      const isCurrentMonth = txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth;

      if (tx.type === 'INCOME') {
        totalIncome += convertedAmount;
        if (isCurrentMonth) monthlyIncome += convertedAmount;
      } else if (tx.type === 'EXPENSE') {
        totalExpense += convertedAmount;
        if (isCurrentMonth) monthlyExpense += convertedAmount;
      }
    }

    const totalBalance = totalIncome - totalExpense;

    res.status(200).json({
      preferredCurrency: prefCurrency,
      totalBalance: Math.round(totalBalance * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      monthlyIncome: Math.round(monthlyIncome * 100) / 100,
      monthlyExpense: Math.round(monthlyExpense * 100) / 100,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Get category distribution for Expense/Income (Pie chart data)
 */
export const getPieChart = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const prefCurrency = await getUserPreferredCurrency(userId);
    const { type } = req.query || {};

    const filterType = type ? type.toUpperCase() : 'EXPENSE';

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        type: filterType,
      },
      include: {
        category: true,
      },
    });

    // Group and convert amounts by category
    const categoryGroups = {};
    let totalVolume = 0;

    for (const tx of transactions) {
      const categoryName = tx.category ? tx.category.name : 'Uncategorized';
      const categoryId = tx.category ? tx.category.id : 'uncategorized';
      const categoryColor = tx.category ? tx.category.color : '#828282';
      const categoryIcon = tx.category ? tx.category.icon : 'help';

      const convertedAmount = convertCurrencySync(tx.amount, tx.currency, prefCurrency);
      totalVolume += convertedAmount;

      if (!categoryGroups[categoryId]) {
        categoryGroups[categoryId] = {
          id: categoryId,
          name: categoryName,
          color: categoryColor,
          icon: categoryIcon,
          amount: 0,
        };
      }
      categoryGroups[categoryId].amount += convertedAmount;
    }

    // Format output with percentages and round values
    const data = Object.values(categoryGroups).map((item) => {
      const amountRounded = Math.round(item.amount * 100) / 100;
      const percentage = totalVolume > 0 ? (amountRounded / totalVolume) * 100 : 0;
      return {
        ...item,
        amount: amountRounded,
        percentage: Math.round(percentage * 10) / 10,
      };
    }).sort((a, b) => b.amount - a.amount);

    res.status(200).json({
      preferredCurrency: prefCurrency,
      totalVolume: Math.round(totalVolume * 100) / 100,
      categories: data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Get monthly trends for the last 6 months (Bar chart data)
 */
export const getMonthlyTrends = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const prefCurrency = await getUserPreferredCurrency(userId);

    // Get date range for the last 6 months (inclusive of current month)
    const now = new Date();
    const monthsRange = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsRange.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleString('default', { month: 'short' }),
        income: 0,
        expense: 0,
      });
    }

    const oldestDate = new Date(monthsRange[0].year, monthsRange[0].month, 1);

    // Fetch transactions in that range sorted by date ascending
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: oldestDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Populate monthly sums
    for (const tx of transactions) {
      const txDate = new Date(tx.date);
      const txYear = txDate.getFullYear();
      const txMonth = txDate.getMonth();

      // Find matching month in our range
      const bucket = monthsRange.find((m) => m.year === txYear && m.month === txMonth);
      if (bucket) {
        const convertedAmount = convertCurrencySync(tx.amount, tx.currency, prefCurrency);
        if (tx.type === 'INCOME') {
          bucket.income += convertedAmount;
        } else if (tx.type === 'EXPENSE') {
          bucket.expense += convertedAmount;
        }
      }
    }

    // Format output
    const data = monthsRange.map((m) => ({
      month: `${m.label} ${m.year.toString().slice(-2)}`,
      income: Math.round(m.income * 100) / 100,
      expense: Math.round(m.expense * 100) / 100,
    }));

    res.status(200).json({
      preferredCurrency: prefCurrency,
      trends: data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Get wallet distribution for Expense/Income (Pie chart data)
 */
export const getWalletPieChart = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const prefCurrency = await getUserPreferredCurrency(userId);
    const { type } = req.query || {};

    const filterType = type ? type.toUpperCase() : 'EXPENSE';

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        type: filterType,
      },
      include: {
        wallet: true,
      },
    });

    // Group and convert amounts by wallet
    const walletGroups = {};
    let totalVolume = 0;

    for (const tx of transactions) {
      const walletName = tx.wallet ? tx.wallet.name : 'Unknown Wallet';
      const walletId = tx.wallet ? tx.wallet.id : 'unknown';
      const walletType = tx.wallet ? tx.wallet.type : 'CASH';

      const convertedAmount = convertCurrencySync(tx.amount, tx.currency, prefCurrency);
      totalVolume += convertedAmount;

      if (!walletGroups[walletId]) {
        walletGroups[walletId] = {
          id: walletId,
          name: walletName,
          type: walletType,
          amount: 0,
        };
      }
      walletGroups[walletId].amount += convertedAmount;
    }

    // Modern color palette for wallets
    const walletColors = ['#3498DB', '#2ECC71', '#E67E22', '#9B59B6', '#E74C3C', '#F1C40F', '#1ABC9C'];

    // Format output with percentages and round values
    const data = Object.values(walletGroups).map((item, index) => {
      const amountRounded = Math.round(item.amount * 100) / 100;
      const percentage = totalVolume > 0 ? (amountRounded / totalVolume) * 100 : 0;
      return {
        ...item,
        color: walletColors[index % walletColors.length],
        amount: amountRounded,
        percentage: Math.round(percentage * 10) / 10,
      };
    }).sort((a, b) => b.amount - a.amount);

    res.status(200).json({
      preferredCurrency: prefCurrency,
      totalVolume: Math.round(totalVolume * 100) / 100,
      wallets: data,
    });
  } catch (error) {
    next(error);
  }
};
