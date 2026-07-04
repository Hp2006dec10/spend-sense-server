import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createAgentTools } from './agentTools.js';
import { env } from '../config/env.js';
import prisma from '../config/db.js';
import { getAgentMemories } from './agentMemoryService.js';

/**
 * Formats memory records into distinct logical blocks for the LLM prompt.
 */
const formatAgentMemories = (memories) => {
  if (memories.length === 0) return 'None.';
  
  const preferences = memories.filter(m => m.type === 'PREFERENCE');
  const habits = memories.filter(m => m.type === 'HABIT');
  const rules = memories.filter(m => m.type === 'RULE');

  let output = '';

  if (preferences.length > 0) {
    output += `[Explicit User Preferences]\n` + preferences.map(m => `- Key: "${m.key}" -> Settings: ${JSON.stringify(m.payload)}`).join('\n') + '\n\n';
  }
  if (rules.length > 0) {
    output += `[Logical Rules & Options]\n` + rules.map(m => `- Key: "${m.key}" -> Rule details: ${JSON.stringify(m.payload)}`).join('\n') + '\n\n';
  }
  if (habits.length > 0) {
    output += `[Inferred Transaction Habits]\n` + habits.map(m => `- Key: "${m.key}" -> Typical pattern: ${JSON.stringify(m.payload)}`).join('\n') + '\n';
  }

  return output.trim() || 'None.';
};

/**
 * Finds up to 5 transactions matching keywords from the user message to provide context.
 */
const findSimilarTransactions = async (userId, userMessage) => {
  try {
    const stopwords = new Set([
      'the', 'and', 'for', 'from', 'today', 'paid', 'with', 'this', 'that', 'spent',
      'yesterday', 'added', 'wallet', 'category', 'inr', 'usd', 'eur', 'account',
      'please', 'show', 'list', 'delete', 'update', 'create', 'add', 'transaction',
      'expense', 'income', 'money', 'i', 'my', 'me', 'to', 'on', 'a', 'an', 'at', 'in'
    ]);

    const keywords = userMessage
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(k => k.length > 2 && !stopwords.has(k));

    if (keywords.length === 0) return [];

    const conditions = keywords.map(kw => ({
      name: { contains: kw, mode: 'insensitive' }
    }));

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        OR: conditions,
      },
      orderBy: { date: 'desc' },
      take: 5,
      include: {
        category: true,
        wallet: true,
        tags: true,
      },
    });

    return transactions;
  } catch (error) {
    console.error('Error finding similar transactions:', error);
    return [];
  }
};

/**
 * Gets the most recent 5 transactions for general temporal context.
 */
const getGeneralRecentTransactions = async (userId) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 5,
      include: {
        category: true,
        wallet: true,
        tags: true,
      },
    });
    return transactions;
  } catch (error) {
    console.error('Error getting recent transactions:', error);
    return [];
  }
};

/**
 * Formats a list of transactions into a readable string list for the prompt.
 */
const formatRecentTransactions = (txs) => {
  if (txs.length === 0) return 'None.';
  return txs
    .map(t => {
      const tagsStr = t.tags && t.tags.length > 0 ? `| Tags: ${t.tags.map(tg => tg.name).join(', ')}` : '';
      const notesStr = t.notes ? `| Notes: ${t.notes}` : '';
      const walletStr = t.wallet ? t.wallet.name : 'N/A';
      const categoryStr = t.category ? t.category.name : 'N/A';
      return `- Date: ${t.date.toISOString().split('T')[0]} | Name: "${t.name}" | Type: ${t.type} | Amount: ${t.amount} ${t.currency} | Category: "${categoryStr}" | Wallet: "${walletStr}" | Payment: ${t.paymentMethod} ${tagsStr} ${notesStr}`;
    })
    .join('\n');
};

/**
 * Gets existing wallets and categories to give the agent full visibility of what exists.
 */
const getExistingEntities = async (userId) => {
  try {
    const wallets = await prisma.wallet.findMany({
      where: { userId },
      select: { name: true, type: true, balance: true }
    });
    const categories = await prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      select: { name: true, type: true }
    });
    return { wallets, categories };
  } catch (e) {
    console.error('Error fetching existing entities:', e);
    return { wallets: [], categories: [] };
  }
};

/**
 * Main chat handler for the Spend Sense agent.
 * Scopes all tool operations to the userId and handles the tool calling loop.
 * 
 * @param {string} userId - ID of the authenticated user.
 * @param {string} userMessage - The user's input string.
 * @param {Array<object>} chatHistory - List of previous messages in the format [{ role: 'user'|'model', content: string }]
 * @returns {Promise<string>} The assistant's text response.
 */
export const chatWithAgent = async (userId, userMessage, chatHistory = [], customApiKey = null) => {
  // Fetch user email to check if they are a guest/test user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const userEmail = user?.email || '';
  const isTestUser = userEmail.endsWith('@spendsense.temp');

  const apiKey = customApiKey || (isTestUser ? env.geminiApiKey : null);
  if (!apiKey) {
    throw new Error('SpendSense AI Agent requires a Gemini API Key. Please configure your key in the Preferences tab first.');
  }

  // 1. Initialize Gemini model
  const model = new ChatGoogleGenerativeAI({
    apiKey,
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    temperature: 0.1, // low temperature for precise tool calling
  });

  // 2. Load and bind tools
  const tools = createAgentTools(userId);
  const modelWithTools = model.bindTools(tools);

  // 3. Fetch past context patterns, existing entities, and memories
  const similarTxs = await findSimilarTransactions(userId, userMessage);
  const recentTxs = await getGeneralRecentTransactions(userId);
  const { wallets, categories } = await getExistingEntities(userId);
  const memories = await getAgentMemories(userId);

  const formattedSimilar = formatRecentTransactions(similarTxs);
  const formattedRecent = formatRecentTransactions(recentTxs);
  const formattedWallets = wallets.map(w => `- "${w.name}" (Type: ${w.type}, Current Balance: ${w.balance})`).join('\n') || 'None';
  const formattedCategories = categories.map(c => `- "${c.name}" (Type: ${c.type})`).join('\n') || 'None';
  const formattedMemories = formatAgentMemories(memories);

  // Get current date and time in user's timezone (using IST default for the user)
  const currentDateStr = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'long'
  });

  // 4. Define agent system instructions
  const systemInstruction = `You are SpendSense AI, a helpful personal finance advisor.
      You help the user manage their money by adding, listing, updating, or deleting transactions, wallets, categories, and tags.
      You have tools to perform these operations directly in the database.
      Always execute actions on behalf of the user using your tools.
      When reporting amounts, use the user's currency.
      CRITICAL: Only access/modify data using the tools provided. Do not invent details not present in the user prompt.

      Current Date and Time: ${currentDateStr}

      BEHAVIORAL RULES:
      
      1. LEARNING FROM HISTORY & PREDICTIONS:
         - Below, you are provided with "Similar Past Transactions" and "Recent Transactions" matching the user's current request.
         - Use these records to infer and auto-fill missing details for new transactions (like amount, category, wallet, paymentMethod, tags) based on their past patterns.
         - If details have changed over time (e.g. rent was 15k, but is 16k recently), prioritize the most recent records.
         
      2. SYSTEM CONSTRAINTS:
         - Payment Method vs Wallet Consistency: Cash wallets ONLY support 'CASH' payment method. Bank wallets support 'CARD', 'UPI', 'BANK_TRANSFER', or 'OTHERS'.
         - If the user specifies a cash payment, automatically default the wallet to "Cash Wallet" and payment method to "CASH".
         - If they specify "Cash Wallet", automatically default the payment method to "CASH".
         
      3. WALLET & CATEGORY RESOLUTION (NO AUTOMATIC CREATION):
         - Refer to the lists of "Existing Wallets" and "Existing Categories" provided below.
         - Do NOT call add_transaction or update_transaction with a new category or wallet name unless the user explicitly tells you to create it (e.g., "Create a new wallet HDFC").
         - If a category or wallet is not in the lists, do not invent/create it. Stop and ask the user: "I couldn't find a category/wallet named [name]. Should I create it, or use one of the existing ones: [list of existing options]?"
         - However, if the user explicitly corrects a category/wallet name, you can resolve it.
         
      4. AMBIGUITY & CONFIRMATION:
         - If a user request is ambiguous, do not guess or invent data. Ask a clarifying question.
         - If the user asks for a risky deletion (deleting a category or a wallet), or a massive/bulk delete (e.g. deleting all transactions), you MUST ask for confirmation first. Do not delete them unless the user explicitly says yes. If they confirm, execute the tool with 'confirmed: true'.
         
      5. MISMATCH CORRECTIONS & CLEANUP:
         - If the user corrects a mismatch (e.g. "no, add it to shopping, not stationery"), you MUST:
           1. Update the transaction to the correct category/wallet using update_transaction.
           2. Immediately delete/cleanup the incorrect duplicate category/wallet that was created by mistake using delete_category or delete_wallet.
         
      6. REFLECTION:
         - When you auto-fill details based on past patterns, explicitly mention your reasoning to the user in your response (e.g. "I've added a transaction for laundry of 650 INR under Home & Utilities paid via UPI from AAA Bank, matching your past pattern.").

      7. ARITHMETIC & BALANCES:
         - Do NOT perform mental math to calculate wallet balances or transaction sums. Always read the balances directly from the tool outputs (such as 'newWalletBalance' or the list of wallets) and report those numbers exactly.

      8. CONFIDENCE-BASED PREDICTION & ACTION FLOW:
         - Before calling any tool to record a transaction, evaluate your prediction confidence:
           * HIGH CONFIDENCE (Proceed automatically):
             - The user's query explicitly contains all details (amount, category, wallet, payment method).
             - OR: The user's query matches a clear, consistent past pattern in "Similar Past Transactions" (e.g., "Laundry" matches past transactions that are consistently 650 INR, Home & Utilities, UPI from AAA Bank).
           * LOW CONFIDENCE (Do NOT execute tool. Ask user first):
             - UNSEEN DATA: There are NO transactions in "Similar Past Transactions" that match the item/action (e.g., user says "I bought Pens for 20" and "Similar Past Transactions" is empty). Do NOT guess the category (like creating "Stationary") or the wallet. Stop and ask: "I see this is the first time you are recording 'Pens'. Which category and wallet should I use?"
             - AMBIGUOUS MATCHES: The "Similar Past Transactions" show multiple conflicting patterns (e.g. travel home by Bus costing 15 INR cash, or Auto costing 100 INR UPI). Do NOT guess. Stop and ask a clarifying question: "Did you go home by Bus or Auto?"
             - DOMINANT TREND BYPASS: If there is an overwhelming dominant trend (e.g. 99 times by Bus, 1 time by Auto), you may consider confidence HIGH and automate it, but mention your assumption in reflection.

      9. DYNAMIC AGENT MEMORY RULES:
         - Below, you are provided with user memory settings inside "PERSISTED AGENT MEMORIES".
         - When resolving defaults for wallets, categories, or payment methods, ALWAYS check "Explicit User Preferences" and "Logical Rules" first. They take precedence over inferred patterns or raw transaction history.
         - When the user explicitly instructs you to remember a rule or preference (e.g. "Remember that my laundry is always paid via UPI from HDFC" or "Default cash transactions to my HDFC pocket wallet"), immediately call the 'save_agent_memory' tool with:
           * type: "PREFERENCE" (for explicit defaults) or "RULE" (for multi-choice or conditional logic options).
           * key: A lowercase, single-word or snake_case key identifying the item (e.g. "laundry", "default_wallet", "travel_home").
           * payload: A JSON stringified string of the properties to remember (e.g. '{"paymentMethod": "UPI", "walletName": "HDFC"}').
         - If the user asks you to forget a memory, call 'delete_agent_memory' with the key and type.

      10. INTERACTIVE CONFIRMATION ACTIONS:
          - When asking user confirmation for risky actions (such as deleting categories, wallets, or executing bulk/massive deletion of transactions), you MUST include clickable confirmation action buttons in your response text:
            * To confirm, use: \`[Yes, Proceed](action://confirm)\`
            * To cancel, use: \`[Cancel](action://cancel)\`
          - Do not output any other custom navigation links or navigate:// protocols.


      EXISTING WALLETS:
      ${formattedWallets}
 
      EXISTING CATEGORIES:
      ${formattedCategories}

      PERSISTED AGENT MEMORIES:
      ${formattedMemories}
 
      RELEVANT USER PATTERNS / HISTORY:
      [Similar Past Transactions]
      ${formattedSimilar}
 
      [Recent Transactions]
      ${formattedRecent}`;

  // 5. Message thread initialization
  const messages = [
    new SystemMessage(systemInstruction),
  ];

  // Add historical context
  for (const msg of chatHistory) {
    if (msg.role === 'user') {
      messages.push(new HumanMessage(msg.content));
    } else if (msg.role === 'model' || msg.role === 'assistant') {
      messages.push(new AIMessage(msg.content));
    }
  }

  // Add current user message
  messages.push(new HumanMessage(userMessage));

  let maxIterations = 12; // Increased to allow multi-step sequential tasks (like adding 7 monthly transactions)
  let response = await modelWithTools.invoke(messages);

  // 6. ReAct Tool execution loop
  while (response.tool_calls && response.tool_calls.length > 0 && maxIterations > 0) {
    maxIterations--;

    // Push the model's message containing tool_calls to history
    messages.push(response);

    // Process all requested tool calls in parallel/sequence
    for (const toolCall of response.tool_calls) {
      const tool = tools.find((t) => t.name === toolCall.name);
      let toolOutput;

      if (!tool) {
        toolOutput = `Error: Tool "${toolCall.name}" not found.`;
      } else {
        try {
          // Execute the tool with the generated args
          toolOutput = await tool.invoke(toolCall.args);
        } catch (err) {
          toolOutput = `Error executing tool: ${err.message}`;
        }
      }

      // Add the ToolMessage containing results
      messages.push(new ToolMessage({
        content: toolOutput,
        tool_call_id: toolCall.id,
        name: toolCall.name,
      }));
    }

    // Call the model again with the tool results appended
    response = await modelWithTools.invoke(messages);
  }

  return response.content;
};

export default {
  chatWithAgent,
};
