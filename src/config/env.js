import dotenv from 'dotenv';
dotenv.config();

const requiredEnvVars = [
  'PORT',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

export const env = {
  port: parseInt(process.env.PORT, 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  geminiApiKey: process.env.GEMINI_API_KEY,
  gatewayAccessCode: process.env.GATEWAY_ACCESS_CODE
};