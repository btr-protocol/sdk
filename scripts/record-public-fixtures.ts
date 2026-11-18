// Re-record the public-API fixtures behind the `src/public`, `cli` and `mcp` tests:
//   bun scripts/record-public-fixtures.ts [--api https://api.btr.markets]
// Read-only GETs plus the two chain-quote POSTs; nothing here signs or sends a transaction.
// `depth.json` is not recorded: /v1/depth prices caller-supplied pool state, so its fixture is a
// hand-written DepthBookWire and stays as committed.

const i = process.argv.indexOf('--api');
const API = (i >= 0 ? process.argv[i + 1]! : 'https://api.btr.markets').replace(/\/$/, '');
const DIR = new URL('../test/fixtures/public/', import.meta.url).pathname;

const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const WETH = '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242';
const WBTC = '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c';

interface Fixture {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Keep the first N rows of an array response: the full ticker list is ~300 KB. */
  head?: number;
}

const FIXTURES: Record<string, Fixture> = {
  chains: { method: 'GET', path: '/v1/chains' },
  venues: { method: 'GET', path: '/v1/venues' },
  pools: { method: 'GET', path: '/v1/pools?chainId=143' },
  'assets-pools': { method: 'GET', path: '/v1/assets/pools?chainId=143' },
  tickers: { method: 'GET', path: '/v1/md/tickers', head: 12 },
  'price-BTC-USDC': { method: 'GET', path: '/v1/md/price/BTC-USDC' },
  'ohlc-BTC-USDC': { method: 'GET', path: '/v1/md/ohlc/BTC-USDC?tf=3600&limit=3' },
  'chain-quote': {
    method: 'POST',
    path: '/v1/chain/quote?chainId=143',
    body: {
      chain_id: 143,
      token_in: USDC,
      token_out: WETH,
      amounts_in: ['0xf4240', '0x989680'],
      slippage: { mode: 'spread', pct: 50 },
    },
  },
  'chain-route': {
    method: 'POST',
    path: '/v1/chain/route?chainId=143',
    body: {
      chain_id: 143,
      token_in: USDC,
      token_out: WBTC,
      amount_in: '0x3b9aca00',
      slippage: { mode: 'spread', pct: 50 },
    },
  },
};

for (const [name, f] of Object.entries(FIXTURES)) {
  const res = await fetch(`${API}${f.path}`, {
    method: f.method,
    headers: f.body ? { 'content-type': 'application/json' } : undefined,
    body: f.body ? JSON.stringify(f.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 200)}`);
  let response: unknown = JSON.parse(text);
  if (f.head && Array.isArray(response)) response = response.slice(0, f.head);
  const out = { method: f.method, path: f.path, body: f.body, status: res.status, response };
  await Bun.write(`${DIR}${name}.json`, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${name}: ${res.status}`);
}
