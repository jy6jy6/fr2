const ccxt = require('ccxt');

// Exchange configurations
const exchanges = {
  binance: new ccxt.binance({
    sandbox: false,
    enableRateLimit: true,
  }),
  mexc: new ccxt.mexc({
    sandbox: false,
    enableRateLimit: true,
  })
};

/**
 * Calculate funding rate interval from timestamps
 * @param {number} currentTime - Current funding timestamp
 * @param {number} nextTime - Next funding timestamp
 * @returns {number} Funding rate interval in hours
 */
function calculateFundingInterval(currentTime, nextTime) {
  if (!currentTime || !nextTime) return null;
  const diffMs = nextTime - currentTime;
  const diffHours = diffMs / (1000 * 60 * 60);
  return Math.round(diffHours);
}

/**
 * Get actual funding rate interval for a specific market
 * @param {Object} exchange - CCXT exchange instance
 * @param {string} symbol - Trading symbol
 * @returns {Promise<number>} Funding rate interval in hours
 */
async function getFundingIntervalForSymbol(exchange, symbol) {
  try {
    // Try to get funding rate history for this specific symbol
    const fundingHistory = await exchange.fetchFundingRateHistory(symbol, undefined, 2);
    if (fundingHistory && fundingHistory.length >= 2) {
      const interval = calculateFundingInterval(
        fundingHistory[0].timestamp,
        fundingHistory[1].timestamp
      );
      return interval;
    }
  } catch (error) {
    // If funding history fails, try to get it from current funding data
  }
  return null;
}

/**
 * Fetch funding rates from MEXC using individual symbol requests
 * @param {Object} exchange - CCXT exchange instance
 * @returns {Promise<Array>} Array of funding rate data
 */
async function fetchMexcFundingRates(exchange) {
  try {
    console.log('Fetching MEXC funding rates using individual symbol method...');

    // Load markets first
    await exchange.loadMarkets();

    const result = [];
    const symbols = Object.keys(exchange.markets).filter(symbol =>
      symbol.includes('/USDT') && exchange.markets[symbol].swap
    );

    console.log(`MEXC: Processing ${symbols.length} perpetual contracts...`);

    // Process symbols in smaller batches for MEXC
    const batchSize = 5;
    for (let i = 0; i < Math.min(symbols.length, 50); i += batchSize) { // Limit to first 50 for performance
      const batch = symbols.slice(i, i + batchSize);

      await Promise.all(batch.map(async (symbol) => {
        try {
          const ticker = await exchange.fetchTicker(symbol);
          const baseSymbol = symbol.replace('/USDT', '');

          // MEXC typically uses 8H intervals
          const fundingIntervalHours = 8;

          result.push({
            exchange: 'MEXC',
            symbol: baseSymbol,
            fullSymbol: symbol,
            fundingRate: null, // MEXC doesn't provide funding rate via ticker
            fundingTimestamp: null,
            fundingDatetime: null,
            nextFundingTime: null,
            nextFundingDatetime: null,
            fundingIntervalHours: fundingIntervalHours,
            markPrice: ticker.last,
            indexPrice: null
          });
        } catch (error) {
          // Skip individual symbols that fail
        }
      }));

      // Delay between batches
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`MEXC: Found ${result.length} perpetual contracts`);
    return result;

  } catch (error) {
    console.error('Error fetching from MEXC:', error.message);
    return [];
  }
}

/**
 * Fetch funding rates from a specific exchange
 * @param {string} exchangeName - Name of the exchange
 * @param {Object} exchange - CCXT exchange instance
 * @returns {Promise<Array>} Array of funding rate data
 */
async function fetchFundingRates(exchangeName, exchange) {
  try {
    console.log(`Fetching funding rates from ${exchangeName}...`);

    // Special handling for MEXC
    if (exchangeName === 'mexc') {
      return await fetchMexcFundingRates(exchange);
    }

    // Load markets first
    await exchange.loadMarkets();

    // Get funding rates for all perpetual contracts
    const fundingRates = await exchange.fetchFundingRates();

    const result = [];

    // Process each symbol to get actual funding intervals
    const symbols = Object.keys(fundingRates).filter(symbol =>
      symbol.includes(':') && symbol.includes('USDT')
    );

    console.log(`${exchangeName}: Processing ${symbols.length} perpetual contracts...`);

    // Process symbols in batches to avoid rate limiting
    const batchSize = 10;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);

      await Promise.all(batch.map(async (symbol) => {
        const data = fundingRates[symbol];
        const baseSymbol = symbol.split(':')[0].replace('/USDT', '');

        // Calculate actual funding interval
        let fundingIntervalHours = null;

        // First try to calculate from current and next funding times
        if (data.fundingTimestamp && data.nextFundingTime) {
          fundingIntervalHours = calculateFundingInterval(data.fundingTimestamp, data.nextFundingTime);
        }

        // If that fails, try to get from funding history
        if (!fundingIntervalHours) {
          try {
            fundingIntervalHours = await getFundingIntervalForSymbol(exchange, symbol);
          } catch (error) {
            // Silently continue if funding history fails
          }
        }

        // Fallback to common intervals based on exchange
        if (!fundingIntervalHours) {
          if (exchangeName === 'binance') {
            fundingIntervalHours = 8; // Most Binance pairs are 8H
          } else {
            fundingIntervalHours = 8; // Default fallback
          }
        }

        result.push({
          exchange: exchangeName.toUpperCase(),
          symbol: baseSymbol,
          fullSymbol: symbol,
          fundingRate: data.fundingRate ? (data.fundingRate * 100).toFixed(6) : null,
          fundingTimestamp: data.fundingTimestamp,
          fundingDatetime: data.fundingDatetime,
          nextFundingTime: data.nextFundingTime,
          nextFundingDatetime: data.nextFundingDatetime,
          fundingIntervalHours: fundingIntervalHours,
          markPrice: data.markPrice,
          indexPrice: data.indexPrice
        });
      }));

      // Small delay between batches to respect rate limits
      if (i + batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`${exchangeName}: Found ${result.length} perpetual contracts`);
    return result;

  } catch (error) {
    console.error(`Error fetching from ${exchangeName}:`, error.message);
    return [];
  }
}

/**
 * Main handler function for Vercel
 */
async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const startTime = Date.now();
    console.log('Starting funding rates fetch...');

    // Fetch from both exchanges in parallel
    const [binanceRates, mexcRates] = await Promise.all([
      fetchFundingRates('binance', exchanges.binance),
      fetchFundingRates('mexc', exchanges.mexc)
    ]);

    // Combine results
    const allRates = [...binanceRates, ...mexcRates];

    // Sort by funding rate (highest first)
    allRates.sort((a, b) => {
      const rateA = parseFloat(a.fundingRate) || 0;
      const rateB = parseFloat(b.fundingRate) || 0;
      return rateB - rateA;
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Calculate funding interval statistics
    const intervalStats = {};
    allRates.forEach(item => {
      const interval = `${item.fundingIntervalHours}H`;
      intervalStats[interval] = (intervalStats[interval] || 0) + 1;
    });

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      fetchDuration: `${duration}ms`,
      totalContracts: allRates.length,
      exchanges: {
        binance: binanceRates.length,
        mexc: mexcRates.length
      },
      fundingIntervals: intervalStats,
      data: allRates,
      summary: {
        highestFundingRate: allRates[0] || null,
        lowestFundingRate: allRates[allRates.length - 1] || null,
        averageFundingRate: allRates.length > 0
          ? (allRates.reduce((sum, item) => sum + (parseFloat(item.fundingRate) || 0), 0) / allRates.length).toFixed(6)
          : 0
      }
    };

    console.log(`Completed in ${duration}ms. Total contracts: ${allRates.length}`);

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in handler:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Export for Vercel
module.exports = handler;

// For local testing
if (require.main === module) {
  (async () => {
    console.log('Running local test...');
    const mockReq = { method: 'GET' };
    const mockRes = {
      setHeader: () => {},
      status: (code) => ({
        json: (data) => console.log(`Status: ${code}`, JSON.stringify(data, null, 2)),
        end: () => console.log(`Status: ${code}`)
      })
    };

    await handler(mockReq, mockRes);
  })();
}