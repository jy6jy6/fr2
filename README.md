# Funding Rate Fetcher

A Node.js API that fetches real-time funding rates from MEXC and Binance futures markets using CCXT. Designed to run on Vercel.

## Features

- ✅ Fetches funding rates from Binance and MEXC futures
- ✅ **Detects actual funding rate intervals (1H, 2H, 4H, 8H) for each coin**
- ✅ Returns funding rates as percentages with timestamps
- ✅ Sorts results by highest funding rate first
- ✅ Provides funding interval statistics breakdown
- ✅ Graceful fallback if one exchange fails
- ✅ CORS enabled for frontend integration
- ✅ Ready for Vercel deployment

## API Response

```json
{
  "success": true,
  "timestamp": "2023-10-22T10:30:00.000Z",
  "fetchDuration": "1250ms",
  "totalContracts": 342,
  "exchanges": {
    "binance": 178,
    "mexc": 164
  },
  "fundingIntervals": {
    "1H": 45,
    "4H": 12,
    "8H": 285
  },
  "data": [
    {
      "exchange": "BINANCE",
      "symbol": "BTC",
      "fullSymbol": "BTC/USDT:USDT",
      "fundingRate": "0.010000",
      "fundingTimestamp": 1698062400000,
      "fundingDatetime": "2023-10-22T08:00:00.000Z",
      "nextFundingTime": 1698091200000,
      "nextFundingDatetime": "2023-10-22T16:00:00.000Z",
      "fundingIntervalHours": 8,
      "markPrice": 34500.5,
      "indexPrice": 34502.1
    }
  ],
  "summary": {
    "highestFundingRate": {...},
    "lowestFundingRate": {...},
    "averageFundingRate": "0.005432"
  }
}
```

## Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Test locally:**
   ```bash
   node api/funding-rates.js
   ```

3. **Run with Vercel CLI:**
   ```bash
   npm install -g vercel
   vercel dev
   ```

## Deployment to Vercel

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Or connect to GitHub:**
   - Push to GitHub repository
   - Import project in Vercel dashboard
   - Deploy automatically on push

## API Endpoints

- `GET /api/funding-rates` - Fetch all funding rates
- `GET /` - Same as above (root endpoint)

## Funding Rate Intervals

The API automatically detects the actual funding rate intervals for each coin:

- **1H**: High-frequency funding (some altcoins)
- **2H**: Medium-frequency funding (specific pairs)
- **4H**: Common for many altcoins
- **8H**: Standard for major pairs (BTC, ETH, etc.)

**Exchange defaults:**
- **Binance**: Varies by coin (1H, 4H, 8H detected automatically)
- **MEXC**: Mostly 8H (limited funding rate data available)

## Technical Details

- **Runtime**: Node.js 18+
- **Dependencies**: CCXT v4+
- **Response Time**: ~1-3 seconds
- **Rate Limiting**: Built-in CCXT rate limiting
- **Error Handling**: Graceful fallback if one exchange fails

## Usage Examples

### Fetch all funding rates:
```bash
curl https://your-deployment.vercel.app/api/funding-rates
```

### Frontend integration:
```javascript
fetch('https://your-deployment.vercel.app/api/funding-rates')
  .then(response => response.json())
  .then(data => {
    console.log('Total contracts:', data.totalContracts);
    console.log('Highest funding rate:', data.summary.highestFundingRate);
  });
```

## Error Handling

The API handles various error scenarios:
- Exchange API failures
- Network timeouts
- Invalid responses
- Rate limiting

If one exchange fails, the other will still return data.

## License

MIT