// Exchange rates relative to INR (base currency)
// In the future, this can be fetched from a live API and cached in memory or database.
const STATIC_EXCHANGE_RATES = {
  INR: 1.0,
  USD: 83.50,    // 1 USD = 83.5 INR
  EUR: 89.80,    // 1 EUR = 89.8 INR
  GBP: 105.80,   // 1 GBP = 105.8 INR
  JPY: 0.52,     // 1 JPY = 0.52 INR
  CAD: 61.20,    // 1 CAD = 61.2 INR
  AUD: 55.60,    // 1 AUD = 55.6 INR
};

/**
 * Converts an amount from one currency to another.
 * Structured with async compatibility in mind so live API fetch can be integrated later.
 * 
 * @param {number} amount - The amount to convert.
 * @param {string} from - Source currency code (e.g. 'USD').
 * @param {string} to - Target currency code (e.g. 'INR').
 * @returns {Promise<number>} Converted amount.
 */
export const convertCurrency = async (amount, from, to) => {
  const fromCode = (from || 'INR').toUpperCase();
  const toCode = (to || 'INR').toUpperCase();
  
  if (fromCode === toCode) return amount;
  
  // Here we use static rates, but in the future we could run:
  // const rates = await fetchLiveRates();
  const rates = STATIC_EXCHANGE_RATES;
  
  const fromRate = rates[fromCode];
  const toRate = rates[toCode];
  
  if (!fromRate || !toRate) {
    throw new Error(`Unsupported currency conversion from ${fromCode} to ${toCode}`);
  }
  
  // Convert from source currency to base currency (INR), then to target currency
  const amountInBase = amount * fromRate;
  const convertedAmount = amountInBase / toRate;
  
  return Math.round(convertedAmount * 100) / 100; // round to 2 decimal places
};

/**
 * Synchronous version for simple mappings (using static rates)
 */
export const convertCurrencySync = (amount, from, to) => {
  const fromCode = (from || 'INR').toUpperCase();
  const toCode = (to || 'INR').toUpperCase();
  
  if (fromCode === toCode) return amount;
  
  const rates = STATIC_EXCHANGE_RATES;
  const fromRate = rates[fromCode];
  const toRate = rates[toCode];
  
  if (!fromRate || !toRate) {
    return amount; // Fallback to original amount if unsupported
  }
  
  const amountInBase = amount * fromRate;
  const convertedAmount = amountInBase / toRate;
  return Math.round(convertedAmount * 100) / 100;
};

export default {
  convertCurrency,
  convertCurrencySync,
  rates: STATIC_EXCHANGE_RATES
};
