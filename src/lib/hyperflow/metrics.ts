import type { Chat, Dataset } from "./normalize";

// All indicators for the Atendimento dashboard. Pure functions, no I/O.
// Rules (business): chats are counted once by _id; chats, messages and interactions are
// different units; Duda-only is never read as "resolved"; incomplete records stay visible.

export type TimeUnit = "s" | "ms" | "min";
export type Handling = "duda_exclusiva" | "transferido" | "humano_direto" | "indeterminado";

export type Config = {
  botNames: string[]; // names of every configured AI agent, not just Duda
  resolvedMarkers: string[]; // classification/label text that PROVES automated resolution
  timeUnit: TimeUnit | null; // unit of queuedTime / *InteractionTime, null until validated
};

export const DEFAULT_CONFIG: Config = { botNames: ["Duda"], resolvedMarkers: [], timeUnit: null };

export const DEFAULT_DEPARTMENTS = ["carteira", "cx", "aquisicao"]; // normalized names
export const EXCLUDED_BY_DEFAULT = "comercial";

export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// ── enrichment ───────────────────────────────────────────────────────────────

export type Row = Chat & {
  handling: Handling;
  humanAgents: string[];
  botTouched: boolean;
  day: string | null;
  waitSec: number | null; // createdAt → firstInteractionAt, from timestamps (unit known)
  durationSec: number | null; // createdAt → finishedAt
  dept: string | null;
  resolvedMarked: boolean;
};

const MAX_WAIT_SEC = 30 * 86400;
const MAX_DURATION_SEC = 90 * 86400;

export function enrich(chats: Chat[], cfg: Config): Row[] {
  const bots = cfg.botNames.map(norm).filter(Boolean);
  const isBot = (name: string) => bots.some((b) => norm(name) === b || (b.length >= 4 && norm(name).includes(b)));
  const markers = cfg.resolvedMarkers.map(norm).filter(Boolean);

  return chats.map((c) => {
    const botTouched = c.agentsAll.some(isBot);
    const humanAgents = c.agentsAll.filter((a) => !isBot(a));
    // Duda × human can only be told apart when the history names at least one agent.
    let handling: Handling = "indeterminado";
    if (c.agentsAll.length > 0) {
      if (botTouched && humanAgents.length === 0) handling = "duda_exclusiva";
      else if (botTouched) handling = "transferido";
      else handling = "humano_direto";
    }
    const wait = c.createdAt && c.firstInteractionAt ? (c.firstInteractionAt.getTime() - c.createdAt.getTime()) / 1000 : null;
    const dur = c.createdAt && c.finishedAt ? (c.finishedAt.getTime() - c.createdAt.getTime()) / 1000 : null;
    return {
      ...c,
      handling,
      humanAgents,
      botTouched,
      day: c.createdAt ? dayKey(c.createdAt) : null,
      waitSec: wait != null && wait >= 0 && wait <= MAX_WAIT_SEC ? wait : null,
      durationSec: dur != null && dur >= 0 && dur <= MAX_DURATION_SEC ? dur : null,
      dept: c.department,
      resolvedMarked:
        markers.length > 0 && [...c.classifications, ...c.labels].some((t) => markers.some((m) => norm(t).includes(m))),
    };
  });
}

// ── filters and scope ────────────────────────────────────────────────────────

export type Filters = {
  start: Date;
  end: Date;
  departments: string[]; // actual department names selected
  agent: string | null;
  classification: string | null;
  includeCampaigns: boolean;
};

export type ScopeStats = {
  total: number;
  undated: number; // no valid createdAt: cannot be placed in any period
  outsidePeriod: number;
  noDepartment: number; // dated, in period, without department
  otherDepartments: number; // dated, in period, department not selected
};

export function applyFilters(rows: Row[], f: Filters): { operational: Row[]; campaigns: Row[]; stats: ScopeStats } {
  const stats: ScopeStats = { total: rows.length, undated: 0, outsidePeriod: 0, noDepartment: 0, otherDepartments: 0 };
  const operational: Row[] = [];
  const campaigns: Row[] = [];
  const t0 = f.start.getTime();
  const t1 = f.end.getTime();
  for (const r of rows) {
    if (!r.createdAt) {
      stats.undated++;
      continue;
    }
    const t = r.createdAt.getTime();
    if (t < t0 || t > t1) {
      stats.outsidePeriod++;
      continue;
    }
    if (!r.dept) {
      stats.noDepartment++;
      continue;
    }
    if (!f.departments.includes(r.dept)) {
      stats.otherDepartments++;
      continue;
    }
    if (f.agent && !r.agentsAll.includes(f.agent)) continue;
    if (f.classification && !r.classifications.includes(f.classification)) continue;
    (r.isBroadcast ? campaigns : operational).push(r);
  }
  return { operational: f.includeCampaigns ? [...operational, ...campaigns] : operational, campaigns, stats };
}

export function previousRange(start: Date, end: Date): { start: Date; end: Date } {
  const len = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  return { start: new Date(prevEnd.getTime() - len), end: prevEnd };
}

export function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

export type Kpis = {
  chats: number;
  messages: number;
  messagesMissing: number; // chats without messagesCount
  interactions: number;
  duda: number; // Duda only, no human agent recorded
  transferred: number; // Duda → human
  humanDirect: number; // human, no Duda participation recorded
  indeterminate: number; // history does not name any agent
  human: number; // transferred + humanDirect
  determinable: number;
  coverage: number; // determinable ÷ chats (0–1)
  automationRate: number | null; // duda ÷ determinable (NOT a resolution rate)
  transferRate: number | null; // transferred ÷ chats Duda took part in
  humanShare: number | null; // human ÷ determinable
  transfers: number;
};

export function computeKpis(rows: Row[]): Kpis {
  const k = {
    chats: rows.length, messages: 0, messagesMissing: 0, interactions: 0,
    duda: 0, transferred: 0, humanDirect: 0, indeterminate: 0, transfers: 0,
  };
  for (const r of rows) {
    if (r.messagesCount == null) k.messagesMissing++;
    else k.messages += r.messagesCount;
    k.interactions += r.interactionsCount;
    k.transfers += r.transfers;
    if (r.handling === "duda_exclusiva") k.duda++;
    else if (r.handling === "transferido") k.transferred++;
    else if (r.handling === "humano_direto") k.humanDirect++;
    else k.indeterminate++;
  }
  const determinable = k.duda + k.transferred + k.humanDirect;
  const dudaTouched = k.duda + k.transferred;
  return {
    ...k,
    human: k.transferred + k.humanDirect,
    determinable,
    coverage: k.chats > 0 ? determinable / k.chats : 0,
    automationRate: determinable > 0 ? k.duda / determinable : null,
    transferRate: dudaTouched > 0 ? k.transferred / dudaTouched : null,
    humanShare: determinable > 0 ? (k.transferred + k.humanDirect) / determinable : null,
  };
}

// Resolution is only claimed when a configured marker proves it.
export function automatedResolution(rows: Row[]): {
  proven: number; dudaOnly: number; closedWithoutHuman: number; rate: number | null;
} {
  const dudaOnly = rows.filter((r) => r.handling === "duda_exclusiva");
  const proven = dudaOnly.filter((r) => r.resolvedMarked).length;
  return {
    proven,
    dudaOnly: dudaOnly.length,
    closedWithoutHuman: dudaOnly.filter((r) => r.finishedAt != null).length,
    rate: dudaOnly.length > 0 ? proven / dudaOnly.length : null,
  };
}

// ── time series ──────────────────────────────────────────────────────────────

export type Granularity = "day" | "week";

export function weekStart(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function bucketOf(day: string, g: Granularity): string {
  if (g === "day") return day;
  const [y, m, d] = day.split("-").map(Number);
  return dayKey(weekStart(new Date(y, m - 1, d)));
}

export function granularityFor(start: Date, end: Date): Granularity {
  return (end.getTime() - start.getTime()) / 86400000 > 45 ? "week" : "day";
}

export type SeriesPoint = {
  key: string;
  label: string;
  total: number;
  byDept: Record<string, number>;
  duda: number;
  transferred: number;
  humanDirect: number;
  indeterminate: number;
  transferRate: number | null;
};

export function timeSeries(rows: Row[], start: Date, end: Date, g: Granularity, depts: string[]): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>();
  const label = (key: string) => {
    const [, m, d] = key.split("-");
    return g === "week" ? `sem ${d}/${m}` : `${d}/${m}`;
  };
  const blank = (key: string): SeriesPoint => ({
    key, label: label(key), total: 0, byDept: Object.fromEntries(depts.map((x) => [x, 0])),
    duda: 0, transferred: 0, humanDirect: 0, indeterminate: 0, transferRate: null,
  });
  for (let d = startOfDay(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const key = bucketOf(dayKey(d), g);
    if (!map.has(key)) map.set(key, blank(key));
  }
  for (const r of rows) {
    if (!r.day) continue;
    const p = map.get(bucketOf(r.day, g));
    if (!p) continue;
    p.total++;
    if (r.dept) p.byDept[r.dept] = (p.byDept[r.dept] ?? 0) + 1;
    if (r.handling === "duda_exclusiva") p.duda++;
    else if (r.handling === "transferido") p.transferred++;
    else if (r.handling === "humano_direto") p.humanDirect++;
    else p.indeterminate++;
  }
  for (const p of map.values()) p.transferRate = p.duda + p.transferred > 0 ? p.transferred / (p.duda + p.transferred) : null;
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function departmentVolumes(rows: Row[]): { dept: string; n: number; share: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.dept) m.set(r.dept, (m.get(r.dept) ?? 0) + 1);
  return [...m.entries()].map(([dept, n]) => ({ dept, n, share: rows.length ? n / rows.length : 0 })).sort((a, b) => b.n - a.n);
}

// ── reasons (classifications) ────────────────────────────────────────────────

export type ReasonStat = {
  name: string;
  n: number;
  share: number; // of all chats in scope (a chat can carry several classifications)
  byDept: Record<string, number>;
  dudaTouched: number;
  transferred: number;
  transferRate: number | null;
  series: Record<string, number>;
};

export function reasonStats(rows: Row[], g: Granularity): { stats: ReasonStat[]; classified: number; unclassified: number } {
  const map = new Map<string, ReasonStat>();
  let classified = 0;
  for (const r of rows) {
    if (r.classifications.length === 0) continue;
    classified++;
    for (const name of r.classifications) {
      let s = map.get(name);
      if (!s) {
        s = { name, n: 0, share: 0, byDept: {}, dudaTouched: 0, transferred: 0, transferRate: null, series: {} };
        map.set(name, s);
      }
      s.n++;
      if (r.dept) s.byDept[r.dept] = (s.byDept[r.dept] ?? 0) + 1;
      if (r.handling === "duda_exclusiva" || r.handling === "transferido") s.dudaTouched++;
      if (r.handling === "transferido") s.transferred++;
      if (r.day) {
        const b = bucketOf(r.day, g);
        s.series[b] = (s.series[b] ?? 0) + 1;
      }
    }
  }
  const stats = [...map.values()]
    .map((s) => ({ ...s, share: rows.length ? s.n / rows.length : 0, transferRate: s.dudaTouched > 0 ? s.transferred / s.dudaTouched : null }))
    .sort((a, b) => b.n - a.n);
  return { stats, classified, unclassified: rows.length - classified };
}

// ── efficiency ───────────────────────────────────────────────────────────────

export type Dist = { n: number; mean: number; median: number; p90: number };

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function dist(values: number[]): Dist | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return { n: v.length, mean: v.reduce((s, x) => s + x, 0) / v.length, median: quantile(v, 0.5), p90: quantile(v, 0.9) };
}

export function byDept<T>(rows: Row[], pick: (r: Row) => T | null, fn: (vals: T[]) => unknown) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const v = pick(r);
    if (!r.dept || v == null) continue;
    m.set(r.dept, [...(m.get(r.dept) ?? []), v]);
  }
  return [...m.entries()].map(([dept, vals]) => ({ dept, value: fn(vals) }));
}

export type TransferStats = {
  withTransfer: number;
  pingPong: number; // 2+ forwards
  perDept: { dept: string; chats: number; withTransfer: number; rate: number }[];
};

export function transferStats(rows: Row[]): TransferStats {
  const per = new Map<string, { chats: number; withTransfer: number }>();
  let withTransfer = 0;
  let pingPong = 0;
  for (const r of rows) {
    if (r.transfers > 0) withTransfer++;
    if (r.transfers >= 2) pingPong++;
    if (!r.dept) continue;
    const p = per.get(r.dept) ?? { chats: 0, withTransfer: 0 };
    p.chats++;
    if (r.transfers > 0) p.withTransfer++;
    per.set(r.dept, p);
  }
  return {
    withTransfer,
    pingPong,
    perDept: [...per.entries()].map(([dept, p]) => ({ dept, ...p, rate: p.chats ? p.withTransfer / p.chats : 0 })).sort((a, b) => b.chats - a.chats),
  };
}

export type AgentStat = { agent: string; participated: number; asFinal: number; messages: number; medianDurationSec: number | null };

export function agentWorkload(rows: Row[], cfg: Config): AgentStat[] {
  const bots = cfg.botNames.map(norm).filter(Boolean);
  const isBot = (n: string) => bots.some((b) => norm(n) === b || (b.length >= 4 && norm(n).includes(b)));
  const m = new Map<string, { participated: number; asFinal: number; messages: number; durs: number[] }>();
  const get = (a: string) => {
    let x = m.get(a);
    if (!x) m.set(a, (x = { participated: 0, asFinal: 0, messages: 0, durs: [] }));
    return x;
  };
  for (const r of rows) {
    for (const a of r.humanAgents) get(a).participated++;
    if (r.agent && !isBot(r.agent)) {
      const x = get(r.agent);
      x.asFinal++;
      x.messages += r.messagesCount ?? 0;
      if (r.durationSec != null) x.durs.push(r.durationSec);
    }
  }
  return [...m.entries()]
    .map(([agent, x]) => ({ agent, participated: x.participated, asFinal: x.asFinal, messages: x.messages, medianDurationSec: dist(x.durs)?.median ?? null }))
    .sort((a, b) => b.asFinal - a.asFinal || b.participated - a.participated);
}

export function hourlyDemand(rows: Row[]): number[] {
  const h = new Array<number>(24).fill(0);
  for (const r of rows) if (r.createdAt) h[r.createdAt.getHours()]++;
  return h;
}

export const TO_SECONDS: Record<TimeUnit, number> = { s: 1, ms: 0.001, min: 60 };

// Compares queuedTime with the real createdAt → firstInteractionAt gap to suggest a unit.
// It is only a suggestion: the dashboard asks the user to confirm before using it.
export function detectTimeUnit(chats: Chat[]): { unit: TimeUnit | null; samples: number; medianRatio: number | null } {
  const ratios: number[] = [];
  for (const c of chats) {
    if (!c.createdAt || !c.firstInteractionAt || !c.queuedTime || c.queuedTime <= 0) continue;
    const gap = (c.firstInteractionAt.getTime() - c.createdAt.getTime()) / 1000;
    if (gap > 0) ratios.push(c.queuedTime / gap);
  }
  if (ratios.length < 20) return { unit: null, samples: ratios.length, medianRatio: null };
  const med = quantile(ratios.sort((a, b) => a - b), 0.5);
  const unit: TimeUnit | null = med >= 0.5 && med <= 2 ? "s" : med >= 500 && med <= 2000 ? "ms" : med >= 0.01 && med <= 0.03 ? "min" : null;
  return { unit, samples: ratios.length, medianRatio: med };
}

// ── formatting ───────────────────────────────────────────────────────────────

export const fmtInt = (n: number) => Math.round(n).toLocaleString("pt-BR");
export const fmtPct = (frac: number | null, digits = 1) => (frac == null ? "—" : `${(frac * 100).toFixed(digits).replace(".", ",")}%`);
export const fmtDelta = (pct: number | null) => (pct == null ? "sem base" : `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1).replace(".", ",")}%`);

export function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1).replace(".", ",")} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1).replace(".", ",")} h`;
  return `${(sec / 86400).toFixed(1).replace(".", ",")} d`;
}

// ── management intelligence: facts, hypotheses, recommendations ──────────────

export type InsightItem = { text: string; evidence: string };
export type Insights = { pending: InsightItem[]; facts: InsightItem[]; hypotheses: InsightItem[]; recommendations: InsightItem[] };

export type InsightInput = {
  dataset: Dataset;
  stats: ScopeStats;
  cur: Kpis;
  prev: Kpis | null; // null when the previous period is not covered by the data
  deptCur: { dept: string; n: number; share: number }[];
  deptPrev: { dept: string; n: number; share: number }[] | null;
  reasons: ReasonStat[];
  classifiedShare: number;
  waitByDept: { dept: string; value: Dist | null }[];
  hourly: number[];
  agents: AgentStat[];
  config: Config;
};

const MIN_N = 10; // minimum sample for any comparative claim

export function buildInsights(i: InsightInput): Insights {
  const pending: InsightItem[] = [];
  const facts: InsightItem[] = [];
  const hypotheses: InsightItem[] = [];
  const recs: InsightItem[] = [];
  const { cur, prev } = i;

  // data pendencies first: they limit everything below
  if (i.dataset.completeness === "incomplete")
    pending.push({ text: "A extração está incompleta: os números abaixo subestimam o período.", evidence: i.dataset.incompleteReasons.join(" ") });
  if (i.dataset.completeness === "unknown")
    pending.push({ text: "A completude da base importada não pode ser verificada.", evidence: "Importação manual: não há como confirmar que todos os atendimentos do período foram exportados." });
  if (cur.chats > 0 && cur.coverage < 0.8)
    pending.push({ text: `Só ${fmtPct(cur.coverage, 0)} dos atendimentos permitem separar IA de humano (conforme os nomes de assistentes cadastrados).`, evidence: `${fmtInt(cur.indeterminate)} atendimentos sem nenhum agente no histórico.` });
  if (cur.chats > 0 && i.classifiedShare < 0.7)
    pending.push({ text: `Só ${fmtPct(i.classifiedShare, 0)} dos atendimentos têm classificação.`, evidence: "Os motivos de contato representam apenas a parte classificada." });
  if (i.config.timeUnit == null)
    pending.push({ text: "A unidade dos campos de tempo (queuedTime e interações) ainda não foi confirmada.", evidence: "Médias desses campos ficam ocultas até a confirmação em análises avançadas." });
  if (i.config.resolvedMarkers.length === 0)
    pending.push({ text: "Não há um rótulo que comprove a resolução pelas IAs.", evidence: "Sem ele, a resolução automatizada não é calculada; só o encerramento sem humano." });
  if (i.stats.undated + i.stats.noDepartment > 0)
    pending.push({ text: "Há registros incompletos fora dos indicadores.", evidence: `${fmtInt(i.stats.undated)} sem data válida e ${fmtInt(i.stats.noDepartment)} sem departamento (dentro do período).` });

  // facts
  if (cur.chats === 0) return { pending, facts, hypotheses, recommendations: recs };
  facts.push({ text: `${fmtInt(cur.chats)} atendimentos únicos no período.`, evidence: `${fmtInt(cur.messages)} mensagens e ${fmtInt(cur.interactions)} interações registradas nesses atendimentos.` });
  if (prev && prev.chats >= MIN_N) {
    const d = pctChange(cur.chats, prev.chats);
    facts.push({ text: `O volume ${d != null && d < 0 ? "caiu" : "subiu"} ${fmtDelta(d)} frente ao período anterior.`, evidence: `${fmtInt(prev.chats)} → ${fmtInt(cur.chats)} atendimentos.` });
    if (cur.transferRate != null && prev.transferRate != null) {
      const pp = (cur.transferRate - prev.transferRate) * 100;
      if (Math.abs(pp) >= 2)
        facts.push({ text: `A taxa de transferência das IAs cadastradas ${pp > 0 ? "subiu" : "caiu"} ${Math.abs(pp).toFixed(1).replace(".", ",")} p.p.`, evidence: `${fmtPct(prev.transferRate)} → ${fmtPct(cur.transferRate)}.` });
    }
    if (cur.automationRate != null && prev.automationRate != null) {
      const pp = (cur.automationRate - prev.automationRate) * 100;
      if (Math.abs(pp) >= 2)
        facts.push({ text: `A taxa de automação validada ${pp > 0 ? "subiu" : "caiu"} ${Math.abs(pp).toFixed(1).replace(".", ",")} p.p.`, evidence: `${fmtPct(prev.automationRate)} → ${fmtPct(cur.automationRate)}.` });
    }
  }
  if (i.deptCur[0]) facts.push({ text: `${i.deptCur[0].dept} concentra a maior demanda.`, evidence: `${fmtInt(i.deptCur[0].n)} atendimentos (${fmtPct(i.deptCur[0].share)} do total).` });
  if (i.deptPrev) {
    for (const d of i.deptCur) {
      const p = i.deptPrev.find((x) => x.dept === d.dept);
      if (p && p.n >= 30 && d.n >= 30) {
        const ch = pctChange(d.n, p.n);
        if (ch != null && Math.abs(ch) >= 20)
          facts.push({ text: `${d.dept}: volume ${ch > 0 ? "subiu" : "caiu"} ${fmtDelta(ch)}.`, evidence: `${fmtInt(p.n)} → ${fmtInt(d.n)} atendimentos.` });
      }
    }
  }
  if (i.reasons[0] && i.classifiedShare > 0)
    facts.push({ text: `Motivo mais frequente: ${i.reasons[0].name}.`, evidence: `${fmtInt(i.reasons[0].n)} atendimentos (${fmtPct(i.reasons[0].share)} do total; um atendimento pode ter mais de uma classificação).` });

  // hypotheses and recommendations (only with enough sample)
  if (cur.transferRate != null) {
    const risky = i.reasons
      .filter((r) => r.dudaTouched >= MIN_N && r.transferRate != null && r.transferRate >= Math.max(0.3, cur.transferRate! * 1.5))
      .sort((a, b) => b.transferred - a.transferred)
      .slice(0, 3);
    for (const r of risky) {
      hypotheses.push({
        text: `As IAs podem não estar cobrindo bem o assunto "${r.name}".`,
        evidence: `${fmtPct(r.transferRate)} dos atendimentos desse motivo que passaram pelas IAs foram transferidos, contra ${fmtPct(cur.transferRate)} no geral (${fmtInt(r.dudaTouched)} atendimentos). Precisa de validação com a leitura de conversas reais.`,
      });
      recs.push({ text: `Revisar o fluxo e a base de conhecimento das IAs para "${r.name}".`, evidence: `${fmtInt(r.transferred)} transferências associadas a esse motivo no período.` });
    }
  }
  if (prev && i.deptPrev) {
    for (const d of i.deptCur) {
      const p = i.deptPrev.find((x) => x.dept === d.dept);
      if (p && p.n >= 30 && d.n >= 30 && (pctChange(d.n, p.n) ?? 0) >= 20)
        hypotheses.push({ text: `O aumento de demanda em ${d.dept} pode ter uma causa pontual (campanha, mudança de produto ou falha).`, evidence: `Volume de ${fmtInt(p.n)} para ${fmtInt(d.n)}. A causa não aparece nos dados e precisa ser confirmada com a área.` });
    }
  }
  const waits = i.waitByDept.filter((w) => w.value && w.value.n >= MIN_N);
  if (waits.length >= 2) {
    const sorted = [...waits].sort((a, b) => b.value!.p90 - a.value!.p90);
    const med = quantileOf(waits.map((w) => w.value!.p90), 0.5);
    if (sorted[0].value!.p90 >= med * 2 && sorted[0].value!.p90 >= 120) {
      hypotheses.push({
        text: `${sorted[0].dept} pode ter um gargalo de capacidade no primeiro atendimento.`,
        evidence: `P90 do tempo até a primeira interação: ${fmtDuration(sorted[0].value!.p90)}, o dobro ou mais da mediana dos departamentos (${fmtDuration(med)}). Esse tempo pode incluir a resposta automática.`,
      });
      const total = i.hourly.reduce((a, b) => a + b, 0);
      const peak = peakWindow(i.hourly, 3);
      if (total > 0 && peak) {
        recs.push({ text: `Avaliar escala ou redistribuição em ${sorted[0].dept} entre ${peak.from}h e ${peak.to}h.`, evidence: `${fmtPct(peak.share, 0)} dos atendimentos entram nessa janela de 3 horas.` });
      }
    }
  }
  if (cur.chats > 0 && i.classifiedShare < 0.7)
    recs.push({ text: "Reforçar a classificação no encerramento do atendimento.", evidence: `Hoje só ${fmtPct(i.classifiedShare, 0)} dos atendimentos são classificados; sem isso os motivos de contato ficam incompletos.` });
  if (cur.chats > 0 && cur.coverage < 0.8)
    recs.push({ text: "Garantir que o histórico de agentes venha na extração.", evidence: `${fmtPct(1 - cur.coverage, 0)} dos atendimentos não permitem separar IA de humano.` });
  if (i.config.resolvedMarkers.length === 0)
    recs.push({ text: "Definir um rótulo ou classificação que comprove a resolução pelas IAs.", evidence: "É o que permite medir resolução automatizada sem presumir que atendimento sem humano é atendimento resolvido." });

  return { pending, facts, hypotheses, recommendations: recs };
}

function quantileOf(values: number[], q: number): number {
  return quantile([...values].sort((a, b) => a - b), q);
}

export function peakWindow(hours: number[], size: number): { from: number; to: number; share: number } | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let best = { from: 0, sum: -1 };
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let k = 0; k < size; k++) sum += hours[(h + k) % 24];
    if (sum > best.sum) best = { from: h, sum };
  }
  return { from: best.from, to: (best.from + size) % 24, share: best.sum / total };
}
