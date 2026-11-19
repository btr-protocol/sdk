// Pure formatting + tree rendering for the `btr` CLI. No I/O, no imports: loaded on demand.

export const DASH = '-';
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function usd(v: number | null | undefined): string {
  const x = n(v);
  const a = Math.abs(x);
  const s =
    a >= 1e9
      ? `${(a / 1e9).toFixed(2)}B`
      : a >= 1e6
        ? `${(a / 1e6).toFixed(2)}M`
        : a >= 1e4
          ? `${(a / 1e3).toFixed(1)}K`
          : a >= 1e3
            ? `${(a / 1e3).toFixed(2)}K`
            : a.toFixed(2);
  return `${x < 0 ? '-' : ''}$${s}`;
}
/** Ratio -> percent. Null is 0%: rates are always computed, never a placeholder. */
export const pct = (v: number | null | undefined, d = 2): string => `${(n(v) * 100).toFixed(d)}%`;
export const bps = (v: number | null | undefined): string => `${n(v).toFixed(1)} bp`;
export const secs = (v: number | null | undefined): string => `${Math.round(n(v))}s`;

/** 5-cell coverage bar: filled = floor(cov*5), clamped. */
export const covBar = (cov: number | null | undefined): string => {
  const f = Math.max(0, Math.min(5, Math.floor(n(cov) * 5)));
  return `${'▮'.repeat(f)}${'▯'.repeat(5 - f)} ${Math.round(n(cov) * 100)}%`;
};

/** Left-aligned first column, right-aligned rest; widths from the content. */
export function table(head: string[], rows: string[][]): string[] {
  const w = head.map((h, i) =>
    Math.max([...h].length, ...rows.map((r) => [...(r[i] ?? '')].length)),
  );
  const cell = (s: string, i: number) => {
    const pad = ' '.repeat(w[i] - [...s].length);
    return i === 0 ? s + pad : pad + s;
  };
  const line = (r: string[]) => r.map(cell).join('  ').trimEnd();
  return [line(head), ...rows.map(line)];
}

export interface TreeAsset {
  symbol: string;
  apy: number;
  coverage: number | null;
  volumeUsd: number;
  tvlUsd: number;
  position: string;
}
export interface TreePool extends Omit<TreeAsset, 'symbol'> {
  name: string;
  assets: TreeAsset[];
}

/** Design A: pool row, legs on ├─ / └─ connector rails. */
export function poolTree(pools: TreePool[]): string[] {
  const head = ['POOL / ASSET', 'APY', 'COVERAGE', 'VOLUME', 'TVL', 'POSITION'];
  const rows: string[][] = [];
  for (const p of pools) {
    const pc = p.coverage === null ? DASH : covBar(p.coverage);
    rows.push([`▾ ${p.name}`, pct(p.apy), pc, usd(p.volumeUsd), usd(p.tvlUsd), p.position]);
    p.assets.forEach((a, i) => {
      const rail = i === p.assets.length - 1 ? '└─' : '├─';
      rows.push([
        `  ${rail} ${a.symbol}`,
        pct(a.apy),
        a.coverage === null ? DASH : covBar(a.coverage),
        usd(a.volumeUsd),
        usd(a.tvlUsd),
        a.position,
      ]);
    });
  }
  return table(head, rows);
}
