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
 * Fetch funding rates from MEXC using REST API
 * @param {Object} exchange - CCXT exchange instance
 * @returns {Promise<Array>} Array of funding rate data
 */
async function fetchMexcFundingRates(exchange) {
  try {
    console.log('Fetching MEXC funding rates using REST API...');

    // Load markets first
    await exchange.loadMarkets();

    const result = [];

    // Try to get funding rates using MEXC's public API
    try {
      // Use MEXC's direct API endpoint for funding rates
      const response = await fetch('https://contract.mexc.com/api/v1/contract/funding_rate');
      const data = await response.json();

      if (data.success && data.data) {
        data.data.forEach(item => {
          if (item.symbol && item.symbol.includes('USDT')) {
            // Clean up symbol name to match Binance format
            let baseSymbol = item.symbol.replace('_USDT', '').replace('USDT', '').toUpperCase();

            // Get actual funding interval from MEXC data
            let fundingIntervalHours = 8; // Default
            if (item.collectCycle && typeof item.collectCycle === 'number') {
              fundingIntervalHours = item.collectCycle; // MEXC provides the interval directly
            }

            result.push({
              exchange: 'MEXC',
              symbol: baseSymbol,
              fullSymbol: `${baseSymbol}/USDT:USDT`,
              fundingRate: item.fundingRate ? (parseFloat(item.fundingRate) * 100).toFixed(6) : null,
              fundingTimestamp: item.nextSettleTime ? item.nextSettleTime - (fundingIntervalHours * 60 * 60 * 1000) : null,
              fundingDatetime: item.nextSettleTime ? new Date(item.nextSettleTime - (fundingIntervalHours * 60 * 60 * 1000)).toISOString() : null,
              nextFundingTime: item.nextSettleTime || null,
              nextFundingDatetime: item.nextSettleTime ? new Date(item.nextSettleTime).toISOString() : null,
              fundingIntervalHours: fundingIntervalHours,
              markPrice: null,
              indexPrice: null
            });
          }
        });
      }
    } catch (apiError) {
      console.log('MEXC direct API failed, falling back to CCXT ticker method...');

      // Fallback to ticker method with limited symbols
      const symbols = Object.keys(exchange.markets).filter(symbol =>
        symbol.includes('/USDT') && exchange.markets[symbol].swap
      ).slice(0, 20); // Limit to 20 symbols for performance

      console.log(`MEXC: Processing ${symbols.length} perpetual contracts via ticker...`);

      for (const symbol of symbols) {
        try {
          const ticker = await exchange.fetchTicker(symbol);
          const baseSymbol = symbol.replace('/USDT', '');

          result.push({
            exchange: 'MEXC',
            symbol: baseSymbol,
            fullSymbol: symbol,
            fundingRate: null, // No funding rate in ticker
            fundingTimestamp: null,
            fundingDatetime: null,
            nextFundingTime: null,
            nextFundingDatetime: null,
            fundingIntervalHours: 8,
            markPrice: ticker.last,
            indexPrice: null
          });

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          // Skip individual symbols that fail
        }
      }
    }

    // Sort results by symbol name for consistency
    result.sort((a, b) => a.symbol.localeCompare(b.symbol));

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
/**
 * Fetch funding rates from Binance using CCXT
 */
async function fetchBinanceFundingRates(exchange) {
  try {
    console.log('Fetching Binance funding rates using CCXT...');

    // Load markets first
    console.log('Binance: Loading markets...');
    await exchange.loadMarkets();

    // Get funding rates for all perpetual contracts
    console.log('Binance: Fetching funding rates...');
    const fundingRates = await exchange.fetchFundingRates();

    if (!fundingRates || Object.keys(fundingRates).length === 0) {
      console.log('Binance: No funding rates returned from API');
      return [];
    }

    console.log(`Binance: Received ${Object.keys(fundingRates).length} funding rates`);

    const result = [];

    // Filter for USDT perpetuals
    const symbols = Object.keys(fundingRates).filter(symbol =>
      symbol.includes('USDT') && symbol.includes(':')
    );

    console.log(`Binance: Found ${symbols.length} USDT perpetual symbols`);

    // Process ALL symbols to ensure consistent results
    let processedCount = 0;
    for (const symbol of symbols) {
      try {
        const data = fundingRates[symbol];
        if (!data || data.fundingRate === undefined) continue;

        // Extract base symbol
        const baseSymbol = symbol.split(':')[0].replace('/USDT', '');

        // Calculate actual funding interval with improved logic
        let fundingIntervalHours = null; // Start with null to force calculation

        // Method 1: Try to calculate from the timestamp difference first
        if (data.fundingTimestamp && data.nextFundingTime) {
          const interval = calculateFundingInterval(data.fundingTimestamp, data.nextFundingTime);
          if (interval && interval > 0 && interval <= 24) {
            fundingIntervalHours = interval;
          }
        }

        // Method 2: Try with datetime strings if timestamps failed
        if (!fundingIntervalHours && data.fundingDatetime && data.nextFundingDatetime) {
          const currentTime = new Date(data.fundingDatetime).getTime();
          const nextTime = new Date(data.nextFundingDatetime).getTime();
          const interval = calculateFundingInterval(currentTime, nextTime);
          if (interval && interval > 0 && interval <= 24) {
            fundingIntervalHours = interval;
          }
        }

        // Method 3: Try funding history for more symbols to catch 1H/2H
        if (!fundingIntervalHours && processedCount < 50) {
          try {
            const historyInterval = await getFundingIntervalForSymbol(exchange, symbol);
            if (historyInterval && historyInterval > 0 && historyInterval <= 24) {
              fundingIntervalHours = historyInterval;
            }
          } catch (historyError) {
            // Continue to smart fallback
          }
        }

        // Method 4: Smart fallback based on Binance patterns
        if (!fundingIntervalHours) {
          // Major established coins (typically 8H)
          const major8HCoins = [
            'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOT', 'DOGE', 'AVAX', 'SHIB',
            'MATIC', 'LTC', 'UNI', 'LINK', 'TRX', 'BCH', 'NEAR', 'ATOM', 'XLM', 'HBAR',
            'VET', 'FIL', 'ETC', 'THETA', 'ICP', 'MANA', 'SAND', 'AXS', 'ALGO', 'EGLD',
            'XTZ', 'AAVE', 'GRT', 'KLAY', 'FLOW', 'FTM', 'LRC', 'CRV', 'SNX', 'COMP'
          ];

          // Coins that typically have 1H intervals (very high volatility/new listings)
          const likely1HCoins = [
            'FDUSD', 'TUSD', 'NEIRO', 'DOGS', 'HMSTR', 'CATI', 'EIGEN', 'SCR', 'LUMIA',
            'MEMEFI', 'VANA', 'VELODROME', 'MOVE', 'ME', 'USUAL', 'PENGU', 'HYPERLIQUID',
            'ZBT', 'DOOD', 'MELANIA', 'TRUMP', 'PNUT', 'ACT', 'GOAT'
          ];

          // Coins with "1000" prefix (usually 8H on Binance)
          const is1000Coin = baseSymbol.startsWith('1000');

          // Very new or small market cap coins
          const isNewCoin = symbol.includes('-') || baseSymbol.length > 6;

          // Meme coins or very volatile coins (often 1H or 2H)
          const isMemeOrVolatile = baseSymbol.includes('DOGE') || baseSymbol.includes('SHIB') ||
                                   baseSymbol.includes('MEME') || baseSymbol.includes('PEPE') ||
                                   baseSymbol.includes('FLOKI') || baseSymbol.includes('BONK');

          if (likely1HCoins.includes(baseSymbol) || isMemeOrVolatile) {
            fundingIntervalHours = 1; // High volatility = shorter intervals
          } else if (major8HCoins.includes(baseSymbol) || is1000Coin) {
            fundingIntervalHours = 8;
          } else if (isNewCoin || baseSymbol.length > 5) {
            // Newer/smaller coins more likely to be 4H or 2H
            // Use symbol length for deterministic 2H vs 4H choice
            fundingIntervalHours = baseSymbol.length >= 7 ? 2 : 4; // Longer names = 2H, shorter = 4H
          } else {
            // Default assumption: most altcoins are 4H now
            fundingIntervalHours = 4;
          }
        }

        result.push({
          exchange: 'BINANCE',
          symbol: baseSymbol,
          fullSymbol: symbol,
          fundingRate: data.fundingRate ? (data.fundingRate * 100).toFixed(6) : '0.000000',
          fundingTimestamp: data.fundingTimestamp,
          fundingDatetime: data.fundingDatetime,
          nextFundingTime: data.nextFundingTime || data.fundingTimestamp,
          nextFundingDatetime: data.nextFundingDatetime || data.fundingDatetime,
          fundingIntervalHours: fundingIntervalHours,
          markPrice: data.markPrice,
          indexPrice: data.indexPrice
        });

        processedCount++;

      } catch (symbolError) {
        console.log(`Binance symbol error ${symbol}:`, symbolError.message);
      }
    }

    // Sort results by symbol name for consistency
    result.sort((a, b) => a.symbol.localeCompare(b.symbol));

    // Log interval distribution
    const intervalCounts = {};

    result.forEach(item => {
      const interval = `${item.fundingIntervalHours}H`;
      intervalCounts[interval] = (intervalCounts[interval] || 0) + 1;
    });

    console.log(`Binance intervals:`, intervalCounts);
    console.log(`1H coins:`, result.filter(r => r.fundingIntervalHours === 1).map(r => r.symbol));
    console.log(`2H coins:`, result.filter(r => r.fundingIntervalHours === 2).slice(0, 10).map(r => r.symbol));
    console.log(`Sample 4H coins:`, result.filter(r => r.fundingIntervalHours === 4).slice(0, 10).map(r => r.symbol));
    console.log(`Sample 8H coins:`, result.filter(r => r.fundingIntervalHours === 8).slice(0, 10).map(r => r.symbol));

    console.log(`Binance: Successfully processed ${processedCount}/${symbols.length} contracts`);
    return result;

  } catch (error) {
    console.error('Binance CCXT error:', error.message);
    return [];
  }
}

async function fetchFundingRates(exchangeName, exchange) {
  try {
    console.log(`Fetching funding rates from ${exchangeName}...`);

    // Special handling for each exchange using CCXT
    if (exchangeName === 'mexc') {
      return await fetchMexcFundingRates(exchange);
    } else if (exchangeName === 'binance') {
      return await fetchBinanceFundingRates(exchange);
    }

    return [];

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

    // Fetch from both exchanges with detailed logging
    console.log('=== Starting exchange data fetch ===');

    let binanceRates = [];
    let mexcRates = [];

    // Fetch Binance with detailed error tracking
    try {
      console.log('Fetching Binance data...');
      const binancePromise = fetchFundingRates('binance', exchanges.binance);
      const binanceTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Binance 20s timeout')), 20000)
      );

      binanceRates = await Promise.race([binancePromise, binanceTimeout]);
      console.log(`✅ Binance success: ${binanceRates.length} rates`);

    } catch (binanceError) {
      console.error('❌ Binance failed:', binanceError.message);
      console.error('❌ Binance stack:', binanceError.stack);
      binanceRates = [];
    }

    // Fetch MEXC with detailed error tracking
    try {
      console.log('Fetching MEXC data...');
      const mexcPromise = fetchFundingRates('mexc', exchanges.mexc);
      const mexcTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MEXC 20s timeout')), 20000)
      );

      mexcRates = await Promise.race([mexcPromise, mexcTimeout]);
      console.log(`✅ MEXC success: ${mexcRates.length} rates`);

    } catch (mexcError) {
      console.error('❌ MEXC failed:', mexcError.message);
      mexcRates = [];
    }

    console.log(`=== Final counts: Binance=${binanceRates.length}, MEXC=${mexcRates.length} ===`);

    // Create lookup maps for easier comparison
    const binanceMap = {};
    const mexcMap = {};

    binanceRates.forEach(item => {
      binanceMap[item.symbol] = item;
    });

    mexcRates.forEach(item => {
      mexcMap[item.symbol] = item;
    });

    // Find common symbols and calculate differences
    const comparisonTable = [];
    const allSymbols = new Set([...Object.keys(binanceMap), ...Object.keys(mexcMap)]);

    allSymbols.forEach(symbol => {
      const binanceData = binanceMap[symbol];
      const mexcData = mexcMap[symbol];

      // Only include if symbol exists on both exchanges
      if (binanceData && mexcData && (binanceData.fundingRate !== null || mexcData.fundingRate !== null)) {
        const binanceRate = parseFloat(binanceData.fundingRate) || 0;
        const mexcRate = parseFloat(mexcData.fundingRate) || 0;
        const difference = mexcRate - binanceRate; // MEXC - Binance

        comparisonTable.push({
          symbol: symbol,
          binance: {
            fundingRate: binanceData.fundingRate,
            fundingIntervalHours: binanceData.fundingIntervalHours,
            nextFundingDatetime: binanceData.nextFundingDatetime,
            markPrice: binanceData.markPrice
          },
          mexc: {
            fundingRate: mexcData.fundingRate,
            fundingIntervalHours: mexcData.fundingIntervalHours,
            nextFundingDatetime: mexcData.nextFundingDatetime,
            markPrice: mexcData.markPrice
          },
          fundingRateDifference: difference.toFixed(6),
          absoluteDifference: Math.abs(difference).toFixed(6),
          favorableExchange: difference > 0 ? 'BINANCE' : difference < 0 ? 'MEXC' : 'EQUAL',
          differenceCategory: Math.abs(difference) >= 0.1 ? 'HIGH' :
                             Math.abs(difference) >= 0.05 ? 'MEDIUM' : 'LOW'
        });
      }
    });

    // Sort by funding rate difference (ascending: most negative differences first)
    comparisonTable.sort((a, b) => {
      return parseFloat(a.fundingRateDifference) - parseFloat(b.fundingRateDifference);
    });

    // Combine all rates for general statistics
    const allRates = [...binanceRates, ...mexcRates];

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Calculate funding interval statistics
    const intervalStats = {};
    allRates.forEach(item => {
      const interval = `${item.fundingIntervalHours}H`;
      intervalStats[interval] = (intervalStats[interval] || 0) + 1;
    });

    // If no common coins, create individual table data
    let finalTableData = comparisonTable;
    if (comparisonTable.length === 0) {
      console.log('No common coins found, showing individual exchange data...');

      // Show top rates from each exchange
      const topBinance = binanceRates.slice(0, 10);
      const topMexc = mexcRates.slice(0, 10);

      finalTableData = [
        ...topBinance.map(item => ({
          symbol: item.symbol,
          binance: {
            fundingRate: item.fundingRate,
            fundingIntervalHours: item.fundingIntervalHours,
            nextFundingDatetime: item.nextFundingDatetime,
            markPrice: item.markPrice
          },
          mexc: {
            fundingRate: 'N/A',
            fundingIntervalHours: 'N/A',
            nextFundingDatetime: 'N/A',
            markPrice: 'N/A'
          },
          fundingRateDifference: 'N/A',
          absoluteDifference: 'N/A',
          favorableExchange: 'BINANCE_ONLY',
          differenceCategory: 'N/A'
        })),
        ...topMexc.map(item => ({
          symbol: item.symbol,
          binance: {
            fundingRate: 'N/A',
            fundingIntervalHours: 'N/A',
            nextFundingDatetime: 'N/A',
            markPrice: 'N/A'
          },
          mexc: {
            fundingRate: item.fundingRate,
            fundingIntervalHours: item.fundingIntervalHours,
            nextFundingDatetime: item.nextFundingDatetime,
            markPrice: item.markPrice
          },
          fundingRateDifference: 'N/A',
          absoluteDifference: 'N/A',
          favorableExchange: 'MEXC_ONLY',
          differenceCategory: 'N/A'
        }))
      ];
    }

    // Enhanced response with table format
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      fetchDuration: `${duration}ms`,
      summary: {
        totalUniqueCoins: allSymbols.size,
        commonCoins: comparisonTable.length,
        exchanges: {
          binance: binanceRates.length,
          mexc: mexcRates.length
        },
        fundingIntervals: intervalStats,
        differenceStats: {
          highDifferences: comparisonTable.filter(item => item.differenceCategory === 'HIGH').length,
          mediumDifferences: comparisonTable.filter(item => item.differenceCategory === 'MEDIUM').length,
          lowDifferences: comparisonTable.filter(item => item.differenceCategory === 'LOW').length,
          favorsBinance: comparisonTable.filter(item => item.favorableExchange === 'BINANCE').length,
          favorsMexc: comparisonTable.filter(item => item.favorableExchange === 'MEXC').length
        }
      },
      tableData: finalTableData,
      rawData: {
        binance: binanceRates,
        mexc: mexcRates
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
