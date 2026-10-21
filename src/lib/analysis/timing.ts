import type { SendMetrics } from "@/lib/analysis/series";

// Day/time analysis. Hours and weekdays are read from the text of the date AC returns
// (the account's local time), never converted through the browser's timezone.

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const BLOCKS = [
  { key: "madrugada", label: "Madrugada", range: "0h–6h", from: 0, to: 6 },
  { key: "manha", label: "Manhã", range: "6h–11h", from: 6, to: 11 },
  { key: "almoco", label: "Almoço", range: "11h–14h", from: 11, to: 14 },
  { key: "tarde", label: "Tarde", range: "14h–18h", from: 14, to: 18 },
  { key: "noite", label: "Noite", range: "18h–24h", from: 18, to: 24 },
] as const;

export function localParts(date: string): { dow: number; hour: number } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/);
  if (!m) return null;
  return { dow: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(), hour: +m[4] };
}

export type GridCell = { n: number; sent: number; open_rate: number; ctr: number };

// weekday (0–6) × block index → performance of sends made then
export function buildSendGrid(sends: SendMetrics[]): GridCell[][] {
  const acc = Array.from({ length: 7 }, () =>
    BLOCKS.map(() => ({ n: 0, sent: 0, opens: 0, clicks: 0 })),
  );
  for (const s of sends) {
    const p = localParts(s.date);
    if (!p) continue;
    const b = BLOCKS.findIndex((x) => p.hour >= x.from && p.hour < x.to);
    if (b < 0) continue;
    const cell = acc[p.dow][b];
    cell.n++;
    cell.sent += s.sent;
    cell.opens += (s.open_rate / 100) * s.sent;
    cell.clicks += (s.ctr / 100) * s.sent;
  }
  return acc.map((row) =>
    row.map((c) => ({
      n: c.n,
      sent: c.sent,
      open_rate: c.sent > 0 ? (c.opens / c.sent) * 100 : 0,
      ctr: c.sent > 0 ? (c.clicks / c.sent) * 100 : 0,
    })),
  );
}

export function shareOf(values: number[]): number[] {
  const t = values.reduce((a, b) => a + b, 0);
  return values.map((v) => (t > 0 ? (v / t) * 100 : 0));
}

// The `size`-hour window holding the largest share of opens.
export function bestWindow(hours: number[], size = 3): { from: number; to: number; share: number } | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let best = { from: 0, sum: -1 };
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let k = 0; k < size; k++) sum += hours[(h + k) % 24];
    if (sum > best.sum) best = { from: h, sum };
  }
  return { from: best.from, to: (best.from + size) % 24, share: (best.sum / total) * 100 };
}
