# SpendSense Backend API Server

SpendSense Backend is a production-grade, highly secure Express.js API server built using Node.js, Prisma ORM, and PostgreSQL. It acts as the backbone of the SpendSense personal finance tracker, providing transaction management, secure authentication (JWT with OTP), and an advanced LLM-powered AI financial agent utilizing LangChain and Google Gemini APIs.

---

## 🚀 Tech Stack & Core Libraries

- **Runtime**: Node.js (ES Modules syntax)
- **Framework**: Express.js
- **Database ORM**: Prisma ORM
- **Database Engine**: PostgreSQL (Supabase pooler ready)
- **Authentication**: JWT (Double token: Access + Refresh flow), bcrypt hashing
- **AI Engine**: LangChain integration with `@langchain/google-genai` (supporting tool-calling ReAct loops)

---

## 🌟 Features Highlight

### 1. Secure Authentication Flow
- **User Registration**: Submits email, full name, and password (enforcing security rules).
- **Brute Force Defense**: Accrues lockouts (30-minute block) after 3 failed login attempts.

### 2. Anonymous Testing Gateway
- Built for competition evaluations.
- Tapping **"Test anonymously"** in the frontend client hits `POST /api/auth/gateway-bypass` sending the `GATEWAY_ACCESS_CODE`.
- Instantly provisions an isolated guest user sandbox (`guest_xxx@spendsense.temp`) seeded with:
  - 14 core categories (Rent, Food & Dining, Freelance, Investments, etc.).
  - 2 wallets (Cash Wallet with type CASH, Savings Account with type BANK).
  - 9 pre-filled historical transactions to populate dashboards and analytics charts immediately.

### 3. Conversational AI Agent (LangChain + Gemini)
- Integrates a ReAct agent loop with tool-calling capabilities.
- The agent has real-time capabilities to create, fetch, delete, and modify categories, wallets, transactions, and tags.
- **Rule Enforcement**: Ensures Cash Wallets only register cash payment methods, auto-suggests categories based on user history, and requests confirmation for destructive bulk deletions.
- **Memory Tracking**: Persists user preferences and habits in an `AgentMemory` DB table.
- **API Key Security**: Fallback global backend API key is restricted **only** to temporary `@spendsense.temp` test users. Normal users must configure and send their own Gemini API keys in request headers.

---

## 📡 API Reference

### 🔐 Authentication (`/api/auth`)
| HTTP Method | Route | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| **POST** | `/signup` | Initialize user signup | No |
| **POST** | `/login` | Standard password verification, returns tokens | No |
| **POST** | `/refresh` | Obtain fresh Access/Refresh tokens | No |
| **POST** | `/gateway-bypass` | Bypasses login, seeds mock account and returns JWT | No |
| **POST** | `/logout` | Invalidate session | Yes |
| **GET** | `/profile` | Retrieve active user profile | Yes |
| **PUT** | `/profile/currency` | Update currency preferences (INR, USD, etc.) | Yes |
| **PUT** | `/profile/ai-toggle` | Enable or disable AI assistant features | Yes |

### 💰 Transactions (`/api/transactions`)
- **GET** `/` - Retrieve transaction list (supports filtering by `type`, `categoryId`, `walletId`, `minAmount`, `maxAmount`, date ranges, search strings, pagination).
- **POST** `/` - Record a transaction (resolves or creates tags inline).
- **PUT** `/:id` - Update transaction details.
- **DELETE** `/:id` - Delete transaction.
- **DELETE** `/bulk/delete` - Mass delete filtered transactions (requires explicit validation confirmation).

### 💳 Wallets (`/api/wallets`)
- **GET** `/` - Retrieve wallets (includes running balance calculation).
- **POST** `/` - Create custom cash/bank wallet.
- **PUT** `/:id` - Rename or update wallet type.
- **DELETE** `/:id` - Delete wallet (cascades transactions).

### 🏷️ Categories (`/api/categories`)
- **GET** `/` - Retrieve categories (auto-seeds defaults if empty).
- **POST** `/` - Create custom category.
- **PUT** `/:id` - Rename or edit category.
- **DELETE** `/:id` - Delete category (cascades transactions).

### 🤖 AI Agent (`/api/agent`)
- **POST** `/chat` - Dispatches message prompt to ReAct agent.
- **GET** `/sessions` - List chat sessions.
- **GET** `/sessions/:sessionId/messages` - Retrieve session chat history.
- **DELETE** `/sessions/:sessionId` - Delete chat session.
- **PUT** `/sessions/:sessionId` - Rename chat session title.

--- 

## 🛠️ Getting Started & Local Setup

### 1. Prerequisites
- **Node.js**: v18.0.0+ (supports global native `fetch` API)
- **PostgreSQL**: An active database instance (e.g. Supabase, local Postgres)

### 2. Installation
Navigate to the backend directory and install required dependencies:
```bash
npm install
```

### 3. Environment Variables Configuration
Create a `.env` file in the root of the `backend/` directory matching the schema in `.env.example`:
```env
PORT=5000
NODE_ENV=development

# Database Configuration
DATABASE_URL=postgresql://<username>:<password>@<host>:<port>/<dbname>

# JWT Authentication Secrets
JWT_ACCESS_SECRET=your-secure-access-token-secret
JWT_REFRESH_SECRET=your-secure-refresh-token-secret

# AI Configuration (Optional globally, falls back to user key)
GEMINI_API_KEY=your-global-gemini-api-key
GEMINI_MODEL=your-gemini-model

# Access Gateway Settings
GATEWAY_ACCESS_CODE=COMP2026
```

### 4. Database Setup
Sync your database schema using Prisma:
```bash
# Push schema structure directly to the database
npx prisma db push

# Generate Prisma Client models
npx prisma generate
```

### 5. Running the Server
```bash
# Run in development mode (with Nodemon hot-reload)
npm run dev

# Run in production mode
npm start
```

---