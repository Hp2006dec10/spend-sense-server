import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import prisma from '../config/db.js';
import { saveAgentMemory, deleteAgentMemory } from './agentMemoryService.js';

/**
 * Creates the set of LangChain tools scoped to a specific user.
 * @param {string} userId - The authenticated user's ID.
 * @returns {Array<DynamicStructuredTool>} Array of tools.
 */
export const createAgentTools = (userId) => {
  return [
    // ----------------------------------------------------
    // TRANSACTIONS TOOLS
    // ----------------------------------------------------
    new DynamicStructuredTool({
      name: 'add_transaction',
      description: 'Add a new transaction (expense or income). If wallet or category do not exist, they will be created.',
      schema: z.object({
        name: z.string().describe('Short name or description of the transaction (e.g. "Starbucks coffee", "Salary")'),
        type: z.enum(['EXPENSE', 'INCOME']).describe('Type of the transaction'),
        amount: z.number().describe('The transaction amount (must be positive)'),
        currency: z.string().default('INR').describe('Currency code (e.g. INR, USD)'),
        categoryName: z.string().describe('The category name (e.g. "Food", "Transport")'),
        walletName: z.string().optional().describe('Name of the wallet to use. Defaults to "Cash Wallet" if not specified'),
        notes: z.string().optional().describe('Optional detailed notes for the transaction'),
        paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'UPI', 'OTHERS']).default('CASH').describe('Payment method used'),
        date: z.string().optional().describe('Optional ISO string or YYYY-MM-DD date. Defaults to current time if not provided'),
        tags: z.array(z.string()).optional().describe('Optional list of tag names to attach'),
        confirmed: z.boolean().optional().default(false).describe('Set to true if user confirmed proceeding after a warning about duplicates or anomalies.'),
      }),
      func: async ({ name, type, amount, currency, categoryName, walletName = 'Cash Wallet', notes, paymentMethod, date, tags, confirmed }) => {
        try {
          if (amount <= 0) {
            return 'Error: Transaction amount must be greater than zero.';
          }
          const typeUpper = type.toUpperCase();
          const pmUpper = paymentMethod.toUpperCase();
          const currencyUpper = currency.toUpperCase();

          // 1. Resolve Wallet (with Fuzzy / Substring match lookup)
          let wallet = await prisma.wallet.findFirst({
            where: {
              userId,
              name: { equals: walletName.trim(), mode: 'insensitive' },
            },
          });

          if (!wallet) {
            // Try fuzzy match lookup against existing user wallets
            const allWallets = await prisma.wallet.findMany({ where: { userId } });
            const cleanInputName = walletName.trim().toLowerCase();
            const fuzzyMatch = allWallets.find(w => {
              const existingName = w.name.toLowerCase();
              return cleanInputName.includes(existingName) || existingName.includes(cleanInputName);
            });

            if (fuzzyMatch) {
              wallet = fuzzyMatch;
            } else {
              // Create wallet dynamically
              const walletType = (pmUpper === 'CARD' || pmUpper === 'BANK_TRANSFER' || pmUpper === 'UPI') ? 'BANK' : 'CASH';
              wallet = await prisma.wallet.create({
                data: {
                  userId,
                  name: walletName.trim(),
                  type: walletType,
                  balance: 0.0,
                },
              });
            }
          }

          // Validate wallet compatibility with paymentMethod
          if (wallet.type === 'CASH' && pmUpper !== 'CASH') {
            return `Error: Cash wallets only support Cash payment method. Please specify a bank wallet or change payment method.`;
          }
          if (wallet.type === 'BANK' && pmUpper === 'CASH') {
            return `Error: Bank wallets do not support Cash payment method. Please specify a cash wallet or change payment method.`;
          }

          // 2. Resolve Category (first check system/user categories with Fuzzy / Substring lookup)
          let category = await prisma.category.findFirst({
            where: {
              name: { equals: categoryName.trim(), mode: 'insensitive' },
              type: typeUpper,
              OR: [{ userId: null }, { userId }],
            },
          });

          if (!category) {
            const allCategories = await prisma.category.findMany({
              where: {
                type: typeUpper,
                OR: [{ userId: null }, { userId }],
              },
            });
            const cleanInputName = categoryName.trim().toLowerCase();
            const fuzzyMatch = allCategories.find(c => {
              const existingName = c.name.toLowerCase();
              return cleanInputName.includes(existingName) || existingName.includes(cleanInputName);
            });

            if (fuzzyMatch) {
              category = fuzzyMatch;
            } else {
              // Create user category
              category = await prisma.category.create({
                data: {
                  userId,
                  name: categoryName.trim(),
                  type: typeUpper,
                  color: typeUpper === 'INCOME' ? '#2ECC71' : '#E74C3C',
                  icon: 'receipt', // default icon
                },
              });
            }
          }

          // 3. Anomaly / Duplicate check: Check if a similar transaction was added within 10 minutes.
          if (!confirmed) {
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            const possibleDuplicate = await prisma.transaction.findFirst({
              where: {
                userId,
                amount,
                type: typeUpper,
                createdAt: { gte: tenMinutesAgo },
                OR: [
                  { name: { equals: name.trim(), mode: 'insensitive' } },
                  { categoryId: category.id },
                ],
              },
            });

            if (possibleDuplicate) {
              return `POTENTIAL_DUPLICATE: A transaction with the name "${possibleDuplicate.name}" and amount ${possibleDuplicate.amount} ${possibleDuplicate.currency} was already added recently under category "${category.name}" (less than 10 minutes ago). Please ask the user to explicitly confirm if they want to proceed or discard the duplicate.`;
            }
          }

          // 4. Resolve Tags
          const resolvedTags = [];
          if (tags && tags.length > 0) {
            for (const tagName of tags) {
              const cleanName = tagName.trim();
              if (!cleanName) continue;

              let tagRecord = await prisma.tag.findFirst({
                where: {
                  userId,
                  name: { equals: cleanName, mode: 'insensitive' },
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
          }

          // 5. Create Transaction & update wallet balance in Prisma transaction
          const result = await prisma.$transaction(async (tx) => {
            const newTx = await tx.transaction.create({
              data: {
                userId,
                name: name.trim(),
                type: typeUpper,
                amount,
                currency: currencyUpper,
                categoryId: category.id,
                notes: notes || null,
                paymentMethod: pmUpper,
                walletId: wallet.id,
                date: date ? new Date(date) : new Date(),
                tags: {
                  connect: resolvedTags,
                },
              },
              include: {
                category: true,
                wallet: true,
                tags: true,
              },
            });

            // Adjust balance
            const adjustment = typeUpper === 'INCOME' ? amount : -amount;
            const updatedWallet = await tx.wallet.update({
              where: { id: wallet.id },
              data: {
                balance: {
                  increment: adjustment,
                },
              },
            });

            if (updatedWallet.type === 'CASH' && updatedWallet.balance < 0) {
              throw new Error(`Insufficient funds. Your "Cash Wallet" balance (${wallet.balance} INR) is not enough for this expense (${amount} INR).`);
            }

            return newTx;
          });

          return JSON.stringify({
            message: 'Transaction successfully added.',
            transaction: {
              id: result.id,
              name: result.name,
              type: result.type,
              amount: result.amount,
              currency: result.currency,
              category: result.category.name,
              wallet: result.wallet.name,
              newWalletBalance: result.wallet.balance + (typeUpper === 'INCOME' ? amount : -amount),
              paymentMethod: result.paymentMethod,
              date: result.date,
              tags: result.tags.map((t) => t.name),
            },
          });
        } catch (err) {
          return `Error adding transaction: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'get_transactions',
      description: 'Retrieve transactions with optional filtering.',
      schema: z.object({
        type: z.enum(['EXPENSE', 'INCOME']).optional().describe('Filter by EXPENSE or INCOME'),
        categoryName: z.string().optional().describe('Filter by category name'),
        walletName: z.string().optional().describe('Filter by wallet name'),
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
        search: z.string().optional().describe('Search query for transaction name or notes'),
        limit: z.number().default(20).describe('Limit the number of results returned'),
      }),
      func: async ({ type, categoryName, walletName, startDate, endDate, search, limit }) => {
        try {
          const parsedLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
          const where = { userId };

          if (type) {
            where.type = type;
          }

          if (categoryName) {
            where.category = {
              name: { equals: categoryName.trim(), mode: 'insensitive' },
            };
          }

          if (walletName) {
            where.wallet = {
              name: { equals: walletName.trim(), mode: 'insensitive' },
            };
          }

          if (startDate || endDate) {
            where.date = {};
            if (startDate) where.date.gte = new Date(startDate);
            if (endDate) where.date.lte = new Date(endDate);
          }

          if (search) {
            where.OR = [
              { name: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
            ];
          }

          const txs = await prisma.transaction.findMany({
            where,
            orderBy: { date: 'desc' },
            take: parsedLimit,
            include: {
              category: true,
              wallet: true,
              tags: true,
            },
          });

          const formatted = txs.map((tx) => ({
            id: tx.id,
            name: tx.name,
            type: tx.type,
            amount: tx.amount,
            currency: tx.currency,
            category: tx.category?.name || 'Uncategorized',
            wallet: tx.wallet?.name || 'N/A',
            date: tx.date,
            notes: tx.notes,
            paymentMethod: tx.paymentMethod,
            tags: tx.tags.map((t) => t.name),
          }));

          return JSON.stringify(formatted);
        } catch (err) {
          return `Error retrieving transactions: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'update_transaction',
      description: 'Update an existing transaction. Will adjust wallet balances if amounts or wallets change.',
      schema: z.object({
        id: z.string().uuid().describe('The UUID of the transaction to update'),
        name: z.string().optional().describe('New name'),
        type: z.enum(['EXPENSE', 'INCOME']).optional().describe('New type'),
        amount: z.number().optional().describe('New amount'),
        currency: z.string().optional().describe('New currency'),
        categoryName: z.string().optional().describe('New category name'),
        walletName: z.string().optional().describe('New wallet name'),
        notes: z.string().optional().describe('New notes'),
        paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'UPI', 'OTHERS']).optional().describe('New payment method'),
        date: z.string().optional().describe('New date string'),
        tags: z.array(z.string()).optional().describe('New tags array (replaces existing tags)'),
      }),
      func: async ({ id, name, type, amount, currency, categoryName, walletName, notes, paymentMethod, date, tags }) => {
        try {
          if (amount !== undefined && amount <= 0) {
            return 'Error: Transaction amount must be greater than zero.';
          }
          // Find existing transaction
          const existing = await prisma.transaction.findFirst({
            where: { id, userId },
            include: { wallet: true },
          });

          if (!existing) {
            return `Error: Transaction not found or not owned by you.`;
          }

          const updateData = {};

          if (name !== undefined) updateData.name = name.trim();
          if (notes !== undefined) updateData.notes = notes;
          if (currency !== undefined) updateData.currency = currency.toUpperCase();
          if (date !== undefined) updateData.date = new Date(date);
          if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod.toUpperCase();

          // Resolve Category if provided
          if (categoryName) {
            const targetType = type || existing.type;
            let category = await prisma.category.findFirst({
              where: {
                name: { equals: categoryName.trim(), mode: 'insensitive' },
                type: targetType,
                OR: [{ userId: null }, { userId }],
              },
            });

            if (!category) {
              // Try fuzzy match lookup
              const allCategories = await prisma.category.findMany({
                where: {
                  type: targetType,
                  OR: [{ userId: null }, { userId }],
                },
              });
              const cleanInputName = categoryName.trim().toLowerCase();
              const fuzzyMatch = allCategories.find(c => {
                const existingName = c.name.toLowerCase();
                return cleanInputName.includes(existingName) || existingName.includes(cleanInputName);
              });

              if (fuzzyMatch) {
                category = fuzzyMatch;
              } else {
                category = await prisma.category.create({
                  data: {
                    userId,
                    name: categoryName.trim(),
                    type: targetType,
                    color: targetType === 'INCOME' ? '#2ECC71' : '#E74C3C',
                    icon: 'receipt',
                  },
                });
              }
            }
            updateData.categoryId = category.id;
          }

          // Resolve Tags if provided
          if (tags) {
            const resolvedTags = [];
            for (const tagName of tags) {
              const cleanName = tagName.trim();
              if (!cleanName) continue;

              let tagRecord = await prisma.tag.findFirst({
                where: {
                  userId,
                  name: { equals: cleanName, mode: 'insensitive' },
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
            updateData.tags = {
              set: resolvedTags,
            };
          }

          // Complex: Wallet / Amount / Type adjustments
          const targetType = type || existing.type;
          const targetAmount = amount !== undefined ? amount : existing.amount;
          let targetWallet = existing.wallet;

          if (walletName) {
            targetWallet = await prisma.wallet.findFirst({
              where: {
                userId,
                name: { equals: walletName.trim(), mode: 'insensitive' },
              },
            });

            if (!targetWallet) {
              // Try fuzzy match lookup
              const allWallets = await prisma.wallet.findMany({ where: { userId } });
              const cleanInputName = walletName.trim().toLowerCase();
              const fuzzyMatch = allWallets.find(w => {
                const existingName = w.name.toLowerCase();
                return cleanInputName.includes(existingName) || existingName.includes(cleanInputName);
              });

              if (fuzzyMatch) {
                targetWallet = fuzzyMatch;
              } else {
                const finalPm = paymentMethod || existing.paymentMethod;
                const walletType = (finalPm === 'CARD' || finalPm === 'BANK_TRANSFER' || finalPm === 'UPI') ? 'BANK' : 'CASH';
                targetWallet = await prisma.wallet.create({
                  data: {
                    userId,
                    name: walletName.trim(),
                    type: walletType,
                    balance: 0.0,
                  },
                });
              }
            }
            updateData.walletId = targetWallet.id;
          }

          // Apply balance adjustments in database transaction
          const updatedTx = await prisma.$transaction(async (tx) => {
            // Revert old transaction's impact on its old wallet
            if (existing.walletId) {
              const oldAdjustment = existing.type === 'INCOME' ? -existing.amount : existing.amount;
              const revertedWallet = await tx.wallet.update({
                where: { id: existing.walletId },
                data: { balance: { increment: oldAdjustment } },
              });

              if (revertedWallet.type === 'CASH' && revertedWallet.balance < 0) {
                throw new Error(`Reverting this transaction would make the Cash wallet balance negative.`);
              }
            }

            // Apply updates
            updateData.type = targetType;
            updateData.amount = targetAmount;

            const finalTx = await tx.transaction.update({
              where: { id },
              data: updateData,
              include: { category: true, wallet: true, tags: true },
            });

            // Apply new transaction's impact on the target wallet
            if (finalTx.walletId) {
              const newAdjustment = targetType === 'INCOME' ? targetAmount : -targetAmount;
              const updatedWallet = await tx.wallet.update({
                where: { id: finalTx.walletId },
                data: { balance: { increment: newAdjustment } },
              });

              if (updatedWallet.type === 'CASH' && updatedWallet.balance < 0) {
                throw new Error(`Insufficient funds. This update would make the Cash wallet balance negative.`);
              }
            }

            return finalTx;
          });

          return JSON.stringify({
            message: 'Transaction successfully updated.',
            transaction: {
              id: updatedTx.id,
              name: updatedTx.name,
              type: updatedTx.type,
              amount: updatedTx.amount,
              currency: updatedTx.currency,
              category: updatedTx.category?.name || 'N/A',
              wallet: updatedTx.wallet?.name || 'N/A',
              notes: updatedTx.notes,
              date: updatedTx.date,
              tags: updatedTx.tags.map((t) => t.name),
            },
          });
        } catch (err) {
          return `Error updating transaction: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'delete_transaction',
      description: 'Delete a transaction by ID. Wallet balance will be adjusted back.',
      schema: z.object({
        id: z.string().uuid().describe('The UUID of the transaction to delete'),
      }),
      func: async ({ id }) => {
        try {
          const existing = await prisma.transaction.findFirst({
            where: { id, userId },
          });

          if (!existing) {
            return `Error: Transaction not found or not owned by you.`;
          }

          await prisma.$transaction(async (tx) => {
            // Revert balance
            if (existing.walletId) {
              const adjustment = existing.type === 'INCOME' ? -existing.amount : existing.amount;
              await tx.wallet.update({
                where: { id: existing.walletId },
                data: { balance: { increment: adjustment } },
              });
            }

            // Delete transaction
            await tx.transaction.delete({
              where: { id },
            });
          });

          return `Transaction with ID ${id} deleted successfully. Wallet balance adjusted.`;
        } catch (err) {
          return `Error deleting transaction: ${err.message}`;
        }
      },
    }),

    // ----------------------------------------------------
    // WALLETS TOOLS
    // ----------------------------------------------------
    new DynamicStructuredTool({
      name: 'create_wallet',
      description: 'Create a new wallet.',
      schema: z.object({
        name: z.string().describe('Name of the wallet (e.g. "HDFC Account", "Pocket Money")'),
        type: z.enum(['CASH', 'BANK']).describe('Type of the wallet'),
        balance: z.number().default(0.0).describe('Starting balance of the wallet'),
      }),
      func: async ({ name, type, balance }) => {
        try {
          const existing = await prisma.wallet.findFirst({
            where: { userId, name: { equals: name.trim(), mode: 'insensitive' } },
          });

          if (existing) {
            return `Error: A wallet named "${name}" already exists.`;
          }

          const wallet = await prisma.wallet.create({
            data: {
              userId,
              name: name.trim(),
              type: type.toUpperCase(),
              balance,
            },
          });

          return JSON.stringify(wallet);
        } catch (err) {
          return `Error creating wallet: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'get_wallets',
      description: 'Retrieve all wallets and their current balances.',
      schema: z.object({}),
      func: async () => {
        try {
          const wallets = await prisma.wallet.findMany({
            where: { userId },
            orderBy: { name: 'asc' },
          });
          return JSON.stringify(wallets);
        } catch (err) {
          return `Error retrieving wallets: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'update_wallet',
      description: 'Update wallet name, type, or directly adjust balance.',
      schema: z.object({
        id: z.string().uuid().describe('The UUID of the wallet'),
        name: z.string().optional().describe('New name'),
        type: z.enum(['CASH', 'BANK']).optional().describe('New type'),
        balance: z.number().optional().describe('New manual balance override'),
      }),
      func: async ({ id, name, type, balance }) => {
        try {
          const wallet = await prisma.wallet.findFirst({
            where: { id, userId },
          });

          if (!wallet) {
            return `Error: Wallet not found or not owned by you.`;
          }

          const data = {};
          if (name !== undefined) data.name = name.trim();
          if (type !== undefined) data.type = type.toUpperCase();
          if (balance !== undefined) data.balance = balance;

          const updated = await prisma.wallet.update({
            where: { id },
            data,
          });

          return JSON.stringify(updated);
        } catch (err) {
          return `Error updating wallet: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'delete_wallet',
      description: 'Delete a wallet. Note: transactions linked to this wallet will have their wallet set to null.',
      schema: z.object({
        id: z.string().uuid().describe('The UUID of the wallet to delete'),
        confirmed: z.boolean().optional().default(false).describe('Set to true only if the user explicitly confirmed deletion of this wallet in the chat history.'),
      }),
      func: async ({ id, confirmed }) => {
        try {
          const wallet = await prisma.wallet.findFirst({
            where: { id, userId },
          });

          if (!wallet) {
            return `Error: Wallet not found or not owned by you.`;
          }

          if (!confirmed) {
            return `CONFIRMATION_REQUIRED: Deleting wallet "${wallet.name}" is a risky action as it might affect associated transactions. Please ask the user to explicitly confirm if they want to delete this wallet before proceeding.`;
          }

          await prisma.wallet.delete({
            where: { id },
          });

          return `Wallet "${wallet.name}" deleted successfully.`;
        } catch (err) {
          return `Error deleting wallet: ${err.message}`;
        }
      },
    }),

    // ----------------------------------------------------
    // CATEGORIES TOOLS
    // ----------------------------------------------------
    new DynamicStructuredTool({
      name: 'create_category',
      description: 'Create a custom category for expenses or income.',
      schema: z.object({
        name: z.string().describe('Name of the category'),
        type: z.enum(['EXPENSE', 'INCOME']).describe('Type of transactions this category applies to'),
        color: z.string().default('#4A90E2').describe('Hex color code (e.g. #FF5733)'),
        icon: z.string().default('receipt').describe('Ionicons icon name'),
      }),
      func: async ({ name, type, color, icon }) => {
        try {
          const existing = await prisma.category.findFirst({
            where: {
              userId,
              name: { equals: name.trim(), mode: 'insensitive' },
              type: type.toUpperCase(),
            },
          });

          if (existing) {
            return `Error: A category named "${name}" of type "${type}" already exists.`;
          }

          const cat = await prisma.category.create({
            data: {
              userId,
              name: name.trim(),
              type: type.toUpperCase(),
              color,
              icon,
            },
          });

          return JSON.stringify(cat);
        } catch (err) {
          return `Error creating category: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'get_categories',
      description: 'Retrieve all available categories (both system defaults and user-specific).',
      schema: z.object({}),
      func: async () => {
        try {
          const categories = await prisma.category.findMany({
            where: {
              OR: [{ userId: null }, { userId }],
            },
            orderBy: [{ userId: 'desc' }, { name: 'asc' }],
          });
          return JSON.stringify(categories);
        } catch (err) {
          return `Error retrieving categories: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'update_category',
      description: 'Update custom category details.',
      schema: z.object({
        id: z.string().uuid().describe('The UUID of the category'),
        name: z.string().optional().describe('New name'),
        color: z.string().optional().describe('New hex color code'),
        icon: z.string().optional().describe('New Ionicons icon name'),
      }),
      func: async ({ id, name, color, icon }) => {
        try {
          const category = await prisma.category.findFirst({
            where: { id, userId },
          });

          if (!category) {
            return `Error: Custom category not found or is a system category that cannot be modified.`;
          }

          const data = {};
          if (name !== undefined) data.name = name.trim();
          if (color !== undefined) data.color = color;
          if (icon !== undefined) data.icon = icon;

          const updated = await prisma.category.update({
            where: { id },
            data,
          });

          return JSON.stringify(updated);
        } catch (err) {
          return `Error updating category: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'delete_category',
      description: 'Delete a custom category. Note: deleting a category will delete all transactions connected to it.',
      schema: z.object({
        id: z.string().uuid().describe('The UUID of the category to delete'),
        confirmed: z.boolean().optional().default(false).describe('Set to true only if the user explicitly confirmed deletion of this category in the chat history.'),
      }),
      func: async ({ id, confirmed }) => {
        try {
          const category = await prisma.category.findFirst({
            where: { id, userId },
          });

          if (!category) {
            return `Error: Custom category not found or is a system category that cannot be deleted.`;
          }

          if (!confirmed) {
            return `CONFIRMATION_REQUIRED: Deleting category "${category.name}" will ALSO delete all associated transactions. This is a highly destructive action. Please ask the user to explicitly confirm if they want to delete this category before proceeding.`;
          }

          await prisma.category.delete({
            where: { id },
          });

          return `Category "${category.name}" and all of its associated transactions deleted successfully.`;
        } catch (err) {
          return `Error deleting category: ${err.message}`;
        }
      },
    }),

    // ----------------------------------------------------
    // TAGS TOOLS
    // ----------------------------------------------------
    new DynamicStructuredTool({
      name: 'create_tag',
      description: 'Create a custom tag.',
      schema: z.object({
        name: z.string().describe('Tag name'),
        color: z.string().default('#A0AEC0').describe('Hex color code'),
      }),
      func: async ({ name, color }) => {
        try {
          const existing = await prisma.tag.findFirst({
            where: { userId, name: { equals: name.trim(), mode: 'insensitive' } },
          });

          if (existing) {
            return `Error: Tag "${name}" already exists.`;
          }

          const tag = await prisma.tag.create({
            data: {
              userId,
              name: name.trim(),
              color,
            },
          });

          return JSON.stringify(tag);
        } catch (err) {
          return `Error creating tag: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'get_tags',
      description: 'Retrieve all of the user\'s tags.',
      schema: z.object({}),
      func: async () => {
        try {
          const tags = await prisma.tag.findMany({
            where: { userId },
            orderBy: { name: 'asc' },
          });
          return JSON.stringify(tags);
        } catch (err) {
          return `Error retrieving tags: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'delete_tag',
      description: 'Delete a tag by ID.',
      schema: z.object({
        id: z.string().uuid().describe('The UUID of the tag to delete'),
      }),
      func: async ({ id }) => {
        try {
          const tag = await prisma.tag.findFirst({
            where: { id, userId },
          });

          if (!tag) {
            return `Error: Tag not found or not owned by you.`;
          }

          await prisma.tag.delete({
            where: { id },
          });

          return `Tag "${tag.name}" deleted successfully.`;
        } catch (err) {
          return `Error deleting tag: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'save_agent_memory',
      description: 'Create or update a custom rule, preference, or habit in user memory. Use this when the user explicitly tells you to remember something, or when you learn a strong recurring transaction pattern.',
      schema: z.object({
        type: z.enum(['PREFERENCE', 'HABIT', 'RULE']).describe('Type of memory: PREFERENCE for explicit instructions, HABIT for inferred patterns, RULE for logical options.'),
        key: z.string().describe('Key identifier for the memory (e.g. "laundry", "default_wallet", "travel_options"). Must be lowercase, single word, or snake_case.'),
        payload: z.string().describe('JSON stringified object containing memory parameters. For preferences, fields like defaultCategory, defaultWallet, defaultPaymentMethod. For rules/habits, keys like amount, options, confidence, etc. Example: \'{"walletName": "HDFC Wallet"}\''),
      }),
      func: async ({ type, key, payload }) => {
        try {
          let parsedPayload;
          try {
            parsedPayload = JSON.parse(payload);
          } catch (e) {
            return `Error: payload must be a valid JSON stringified object. Detailed parsing error: ${e.message}`;
          }
          await saveAgentMemory(userId, type, key, parsedPayload);
          return `Successfully saved memory of type "${type}" for key "${key}".`;
        } catch (err) {
          return `Error saving memory: ${err.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'delete_agent_memory',
      description: 'Delete/forget an agent memory preference or rule by type and key.',
      schema: z.object({
        type: z.enum(['PREFERENCE', 'HABIT', 'RULE']).describe('Type of memory to delete.'),
        key: z.string().describe('Key of the memory to delete.'),
      }),
      func: async ({ type, key }) => {
        try {
          await deleteAgentMemory(userId, type, key);
          return `Successfully deleted/forgot agent memory for key "${key}" of type "${type}".`;
        } catch (err) {
          return `Error deleting agent memory: ${err.message}`;
        }
      },
    }),
  ];
};
