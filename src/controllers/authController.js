import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import { env } from '../config/env.js';

import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';

// Password Validation Regex
// Minimum 8 characters, at least one uppercase letter, one lowercase letter, one number, and one special character
const PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Helper to record audit logs.
 */
const logAudit = async (userId, action, req) => {
  try {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error('Audit logging failed:', error);
  }
};

/**
 * 1. User Registration
 */
export const signup = async (req, res, next) => {
  try {
    const { fullName, email, password, confirmPassword } = req.body || {};

    if (!fullName || !email || !password || !confirmPassword) {
      const error = new Error('All fields are required');
      error.statusCode = 400;
      return next(error);
    }

    // Validations
    if (!EMAIL_REGEX.test(email)) {
      const error = new Error('Invalid email format');
      error.statusCode = 400;
      return next(error);
    }

    if (!PASSWORD_POLICY_REGEX.test(password)) {
      const error = new Error('Password must be at least 8 characters long and include an uppercase letter, lowercase letter, number, and special character');
      error.statusCode = 400;
      return next(error);
    }

    if (password !== confirmPassword) {
      const error = new Error('Passwords do not match');
      error.statusCode = 400;
      return next(error);
    }

    // Check duplicate account
    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const error = new Error('Email is already registered');
      error.statusCode = 400;
      return next(error);
    }

    // Create new active and verified user
    const passwordHash = await bcrypt.hash(password, 10);
    user = await prisma.user.create({
      data: {
        email,
        fullName,
        passwordHash,
        isActive: true,
        isEmailVerified: true,
      },
    });

    // Auto login: generate JWT tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await logAudit(user.id, 'REGISTRATION_SUCCESS', req);

    res.status(200).json({
      success: true,
      message: 'Registration successful. You are now logged in.',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    });
  } catch (err) {
    next(err);
  }
};



/**
 * 4. User Login
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      const error = new Error('Email and password are required');
      error.statusCode = 400;
      return next(error);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      return next(error);
    }

    // Lockout check
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      const remainingTime = Math.ceil((user.lockoutUntil - new Date()) / 60000);
      const error = new Error(`Account locked for 30 minutes due to 3 failed login attempts. Try again in ${remainingTime} minutes.`);
      error.statusCode = 403;
      return next(error);
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      const updatedAttempts = user.loginAttempts + 1;
      if (updatedAttempts >= 3) {
        const lockoutTime = new Date(Date.now() + 30 * 60 * 1000);
        await prisma.user.update({
          where: { id: user.id },
          data: {
            loginAttempts: 0,
            lockoutUntil: lockoutTime,
          },
        });
        await logAudit(user.id, 'LOGIN_LOCKOUT', req);
        const error = new Error('Account locked for 30 minutes due to 3 failed login attempts.');
        error.statusCode = 403;
        return next(error);
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: { loginAttempts: updatedAttempts },
        });
        await logAudit(user.id, 'LOGIN_FAILED', req);
        const error = new Error('Invalid email or password');
        error.statusCode = 401;
        return next(error);
      }
    }

    // Reset login attempts and lockout, and set user to active and verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginAttempts: 0,
        lockoutUntil: null,
        isActive: true,
        isEmailVerified: true,
      },
    });

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await logAudit(user.id, 'LOGIN_SUCCESS', req);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    });
  } catch (err) {
    next(err);
  }
};



/**
 * 7. Token Refresh
 */
export const tokenRefresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      const error = new Error('Refresh token is required');
      error.statusCode = 400;
      return next(error);
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.jwtRefreshSecret);
    } catch (e) {
      const error = new Error('Invalid or expired refresh token');
      error.statusCode = 401;
      return next(error);
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive) {
      const error = new Error('User account is suspended or not found');
      error.statusCode = 401;
      return next(error);
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 8. User Logout
 */
export const logout = async (req, res, next) => {
  try {
    // Audit logout action if user is authenticated and update active state
    if (req.user && req.user.userId) {
      await prisma.user.update({
        where: { id: req.user.userId },
        data: { isActive: false },
      });
      await logAudit(req.user.userId, 'USER_LOGOUT', req);
    }
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 9. Get Profile (Helper endpoint to check auth works)
 */
export const getProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      return next(error);
    }
    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isEmailVerified: user.isEmailVerified,
        preferredCurrency: user.preferredCurrency,
        isAiEnabled: user.isAiEnabled,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 10. Update Preferred Currency
 */
export const updatePreferredCurrency = async (req, res, next) => {
  try {
    const { preferredCurrency } = req.body || {};
    if (!preferredCurrency) {
      const error = new Error('Preferred currency is required');
      error.statusCode = 400;
      return next(error);
    }

    const currencyUpper = preferredCurrency.toUpperCase();
    const validCurrencies = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
    
    if (!validCurrencies.includes(currencyUpper)) {
      const error = new Error(`Unsupported currency code. Supported: ${validCurrencies.join(', ')}`);
      error.statusCode = 400;
      return next(error);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: { preferredCurrency: currencyUpper },
    });

    await logAudit(req.user.userId, `UPDATE_PREFERRED_CURRENCY_${currencyUpper}`, req);

    res.status(200).json({
      success: true,
      message: `Preferred currency updated to ${currencyUpper}`,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        preferredCurrency: updatedUser.preferredCurrency,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 11. Update AI Opt-In Status
 */
export const updateAiOptInStatus = async (req, res, next) => {
  try {
    const { isAiEnabled } = req.body || {};
    if (typeof isAiEnabled !== 'boolean') {
      const error = new Error('isAiEnabled must be a boolean');
      error.statusCode = 400;
      return next(error);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: { isAiEnabled },
    });

    res.status(200).json({
      success: true,
      message: `AI opt-in status updated to ${isAiEnabled}`,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        isAiEnabled: updatedUser.isAiEnabled,
        preferredCurrency: updatedUser.preferredCurrency,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Helper to seed default data for a guest user.
 */
const seedGuestData = async (userId) => {
  // 1. Precreate default categories for this user
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

  const categories = await prisma.category.findMany({
    where: { userId }
  });

  const categoryMap = {};
  categories.forEach(c => {
    categoryMap[c.name] = c.id;
  });

  // 2. Create wallets
  const cashWallet = await prisma.wallet.create({
    data: {
      userId,
      name: 'Cash Wallet',
      type: 'CASH',
      balance: 0.0,
    }
  });

  const bankWallet = await prisma.wallet.create({
    data: {
      userId,
      name: 'Savings Account',
      type: 'BANK',
      balance: 0.0,
    }
  });

  // 3. Seed transactions
  const now = new Date();
  const daysAgo = (num) => {
    const d = new Date();
    d.setDate(now.getDate() - num);
    return d;
  };

  const transactionsToCreate = [
    {
      userId,
      name: 'Monthly Salary',
      type: 'INCOME',
      amount: 85000,
      currency: 'INR',
      categoryId: categoryMap['Salary'],
      notes: 'Monthly corporate salary credit',
      paymentMethod: 'BANK_TRANSFER',
      walletId: bankWallet.id,
      date: daysAgo(5),
    },
    {
      userId,
      name: 'Apartment Rent',
      type: 'EXPENSE',
      amount: 18000,
      currency: 'INR',
      categoryId: categoryMap['Rent / Housing'],
      notes: 'Monthly rent for apartment',
      paymentMethod: 'BANK_TRANSFER',
      walletId: bankWallet.id,
      date: daysAgo(4),
    },
    {
      userId,
      name: 'Weekly Groceries',
      type: 'EXPENSE',
      amount: 2450,
      currency: 'INR',
      categoryId: categoryMap['Food & Dining'],
      notes: 'Vegetables and dairy items',
      paymentMethod: 'CASH',
      walletId: cashWallet.id,
      date: daysAgo(3),
    },
    {
      userId,
      name: 'Starbucks Coffee',
      type: 'EXPENSE',
      amount: 380,
      currency: 'INR',
      categoryId: categoryMap['Food & Dining'],
      notes: 'Caramel Macchiato',
      paymentMethod: 'CASH',
      walletId: cashWallet.id,
      date: daysAgo(2),
    },
    {
      userId,
      name: 'Zara Shopping',
      type: 'EXPENSE',
      amount: 4800,
      currency: 'INR',
      categoryId: categoryMap['Shopping'],
      notes: 'Winter jacket and shirt',
      paymentMethod: 'CARD',
      walletId: bankWallet.id,
      date: daysAgo(2),
    },
    {
      userId,
      name: 'Uber Ride',
      type: 'EXPENSE',
      amount: 620,
      currency: 'INR',
      categoryId: categoryMap['Transport / Travel'],
      notes: 'Ride to city center office',
      paymentMethod: 'UPI',
      walletId: bankWallet.id,
      date: daysAgo(1),
    },
    {
      userId,
      name: 'Electricity Bill',
      type: 'EXPENSE',
      amount: 1850,
      currency: 'INR',
      categoryId: categoryMap['Utilities'],
      notes: 'State board power charges',
      paymentMethod: 'UPI',
      walletId: bankWallet.id,
      date: daysAgo(1),
    },
    {
      userId,
      name: 'Stock Dividend Payout',
      type: 'INCOME',
      amount: 1500,
      currency: 'INR',
      categoryId: categoryMap['Investments'],
      notes: 'Quarterly dividend payment',
      paymentMethod: 'BANK_TRANSFER',
      walletId: bankWallet.id,
      date: now,
    },
    {
      userId,
      name: 'Refund',
      type: 'INCOME',
      amount: 4000,
      currency: 'INR',
      categoryId: categoryMap['Refunds'],
      notes: 'Refund of unused premium subscription',
      paymentMethod: 'CASH',
      walletId: cashWallet.id,
      date: daysAgo(10),
    }
  ];

  await prisma.transaction.createMany({
    data: transactionsToCreate
  });
};

/**
 * 12. Temporary Gateway Bypass
 */
export const gatewayBypass = async (req, res, next) => {
  try {
    const { accessCode } = req.body || {};

    if (!accessCode) {
      const error = new Error('Access code is required');
      error.statusCode = 400;
      return next(error);
    }

    if (accessCode.trim() !== env.gatewayAccessCode) {
      const error = new Error('Invalid gateway access code');
      error.statusCode = 401;
      return next(error);
    }

    // Access code is valid. Create a temporary reviewer user
    const guestId = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const email = `guest_${guestId}@spendsense.temp`;
    const fullName = 'Guest Reviewer';

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        fullName,
        passwordHash: 'gateway_bypass_placeholder',
        isActive: true,
        isEmailVerified: true,
      },
    });

    // Seed data (wallets, categories, transactions)
    await seedGuestData(user.id);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await logAudit(user.id, 'GUEST_BYPASS_LOGIN', req);

    res.status(200).json({
      success: true,
      message: 'Access gateway bypass successful',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    });
  } catch (err) {
    next(err);
  }
};
