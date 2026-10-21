import type { Campaign } from "@/lib/ac.functions";

// Pure analytics over already-loaded campaigns: group sends of the same recurring
// "series" (Newsletter Giro Adiante #4/#5/#6, Prospect Sacados GL, ...), then judge
// the latest send against the history of its own series.

export type SendMetrics = {
  id: string;
  name: string;
  listId: string | null;
  date: string; // as returned by AC
  sent: number;
  open_rate: number;
  ctr: number; // unique clicks / sent
  ctor: number; // unique clicks / unique opens
  bounce_rate: number;
  unsub_rate: number;
};

export function toSendMetrics(c: Campaign): SendMetrics | null {
  if (c.send_amt <= 0 || !c.sdate) return null;
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
  return {
    id: c.id,
    name: c.name,
    listId: c.listId,
    date: c.sdate,
    sent: c.send_amt,
    open_rate: c.open_rate,
    ctr: c.ctr,
    ctor: pct(c.uniquelinkclicks, c.uniqueopens),
    bounce_rate: pct(c.hardbounces + c.softbounces, c.send_amt),
    unsub_rate: pct(c.unsubscribes, c.send_amt),
  };
}

const MONTHS = "janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";

// Removes the parts of a campaign name that change between sends of the same series.
export function seriesLabel(name: string): string {
  return name
    .replace(/\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/g, " ")
    .replace(new RegExp(`\\b(${MONTHS})\\b`, "gi"), " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/\(\s*\d+\s*\)/g, " ")
    .replace(/\s+\d{1,2}\s*$/, " ")
    .replace(/[\s\-–—/|:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function groupKey(name: string): string {
  return normalizeText(seriesLabel(name)).replace(/[^a-z0-9+[\]\s]/g, " ").replace(/\s+/g, " ").trim();
}

export type Series = { key: string; label: string; sends: SendMetrics[] }; // sends newest first

export function buildSeries(campaigns: Campaign[], minSends = 2): Series[] {
  const map = new Map<string, SendMetrics[]>();
  for (const c of campaigns) {
    const m = toSendMetrics(c);
    if (!m) continue;
    const k = groupKey(c.name);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), m]);
  }
  return [...map.entries()]
    .filter(([, sends]) => sends.length >= minSends)
    .map(([key, sends]) => {
      const sorted = [...sends].sort((a, b) => b.date.localeCompare(a.date));
      return { key, label: seriesLabel(sorted[0].name) || sorted[0].name, sends: sorted };
    })
    .sort((a, b) => b.sends[0].date.localeCompare(a.sends[0].date));
}

export function seriesByKeyword(campaigns: Campaign[], keyword: string): SendMetrics[] {
  const k = normalizeText(keyword.trim());
  if (!k) return [];
  return campaigns
    .filter((c) => normalizeText(c.name).includes(k))
    .map(toSendMetrics)
    .filter((m): m is SendMetrics => m !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type MetricKey = "open_rate" | "ctr" | "ctor" | "bounce_rate" | "unsub_rate";

export const METRIC_LABEL: Record<MetricKey, string> = {
  open_rate: "Abertura",
  ctr: "CTR",
  ctor: "CTOR",
  bounce_rate: "Bounce",
  unsub_rate: "Descadastro",
};

export const METRIC_HELP: Record<MetricKey, string> = {
  open_rate: "Aberturas únicas ÷ envios",
  ctr: "Cliques únicos ÷ envios",
  ctor: "Cliques únicos ÷ aberturas únicas: o quanto o e-mail converte quem abriu",
  bounce_rate: "E-mails que não chegaram ÷ envios",
  unsub_rate: "Descadastros ÷ envios",
};

// For bounce/unsub, going up is bad.
export const HIGHER_IS_BETTER: Record<MetricKey, boolean> = {
  open_rate: true,
  ctr: true,
  ctor: true,
  bounce_rate: false,
  unsub_rate: false,
};

const METRICS: MetricKey[] = ["open_rate", "ctr", "ctor", "bounce_rate", "unsub_rate"];
const BASELINE_WINDOW = 5;
const MEANINGFUL_REL_CHANGE = 0.15; // ±15% relative to baseline counts as a real move
const SMALL_SAMPLE = 100;

export type Comparison = {
  latest: SendMetrics;
  baseline: Record<MetricKey, number>; // volume-weighted average of the previous sends
  baselineCount: number;
  delta: Record<MetricKey, { abs: number; rel: number }>; // abs in percentage points
  warnings: string[];
  diagnosis: string[];
};

export function compareLatest(sends: SendMetrics[]): Comparison | null {
  if (sends.length < 2) return null;
  const [latest, ...rest] = sends; // sends sorted newest first
  const prev = rest.slice(0, BASELINE_WINDOW);
  const totalSent = prev.reduce((s, p) => s + p.sent, 0);

  const baseline = {} as Record<MetricKey, number>;
  const delta = {} as Record<MetricKey, { abs: number; rel: number }>;
  for (const m of METRICS) {
    // Weighted by volume so a 50-contact send doesn't weigh like a 5,000-contact one.
    baseline[m] = totalSent > 0 ? prev.reduce((s, p) => s + p[m] * p.sent, 0) / totalSent : 0;
    const abs = latest[m] - baseline[m];
    delta[m] = { abs, rel: baseline[m] > 0 ? abs / baseline[m] : 0 };
  }

  const warnings: string[] = [];
  if (latest.sent < SMALL_SAMPLE) {
    warnings.push(`Amostra pequena (${latest.sent} envios): variações de poucos pontos podem ser só ruído.`);
  }
  const ageH = (Date.now() - new Date(latest.date.replace(" ", "T")).getTime()) / 36e5;
  if (ageH >= 0 && ageH < 48) {
    warnings.push("Disparo recente (menos de 48h): aberturas e cliques ainda estão chegando. Compare de novo mais tarde.");
  }
  if (prev.length < 3) {
    warnings.push(`Só ${prev.length} disparo(s) anterior(es) para comparar: a média de referência é frágil.`);
  }

  return { latest, baseline, baselineCount: prev.length, delta, warnings, diagnosis: diagnose(delta) };
}

function moved(d: { rel: number }, dir: 1 | -1) {
  return d.rel * dir >= MEANINGFUL_REL_CHANGE;
}

function diagnose(delta: Record<MetricKey, { abs: number; rel: number }>): string[] {
  const out: string[] = [];
  const openDown = moved(delta.open_rate, -1);
  const openUp = moved(delta.open_rate, 1);
  const ctorDown = moved(delta.ctor, -1);
  const ctorUp = moved(delta.ctor, 1);

  if (openDown && !ctorDown) {
    out.push(
      "A abertura caiu, mas quem abriu clicou na mesma proporção: o conteúdo continua funcionando e o problema está em chegar e ser aberto. Revise assunto, remetente, horário de envio e entregabilidade (spam).",
    );
  } else if (!openDown && ctorDown) {
    out.push(
      "A abertura ficou estável, mas o CTOR caiu: o assunto atraiu e o corpo do e-mail não converteu. Revise CTA, oferta, posição do link e se o link está funcionando.",
    );
  } else if (openDown && ctorDown) {
    out.push(
      "Abertura e CTOR caíram juntos: suspeite da audiência (segmento diferente, lista envelhecida, base menos engajada) antes de mexer no criativo.",
    );
  } else if (openUp && ctorUp) {
    out.push("Abertura e CTOR subiram: vale registrar o que mudou neste disparo para repetir.");
  } else if (openUp && !ctorUp) {
    out.push("A abertura subiu sem ganho de cliques: o assunto atrai mais, mas o corpo do e-mail não acompanha.");
  }

  if (moved(delta.bounce_rate, 1) && delta.bounce_rate.abs >= 0.3) {
    out.push("O bounce subiu: sinal de qualidade da lista. Verifique e-mails inválidos antes do próximo envio.");
  }
  if (moved(delta.unsub_rate, 1) && delta.unsub_rate.abs >= 0.1) {
    out.push("Os descadastros subiram: possível fadiga, frequência alta ou segmentação fora do alvo.");
  }
  if (out.length === 0) out.push("Sem variação relevante frente ao histórico desta série.");
  return out;
}

// ── Alerta de desvio ─────────────────────────────────────────────────────────

export type Severity = "critical" | "warning" | "ok" | "positive" | "insufficient";

export type SeriesAssessment = {
  series: Series;
  severity: Severity;
  latest: SendMetrics;
  comparison: Comparison | null;
  worst: { metric: "open_rate" | "ctr"; z: number; rel: number } | null;
};

function weightedMean(prev: SendMetrics[], m: MetricKey) {
  const t = prev.reduce((s, p) => s + p.sent, 0);
  return t > 0 ? prev.reduce((s, p) => s + p[m] * p.sent, 0) / t : 0;
}

function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

// A send is flagged when it's both a large relative move AND outside the series' own
// usual variation (z-score), so naturally noisy series don't cry wolf.
export function assessSeries(series: Series): SeriesAssessment {
  const [latest, ...rest] = series.sends;
  const prev = rest.slice(0, BASELINE_WINDOW);
  const comparison = compareLatest(series.sends);
  if (prev.length < 2) return { series, severity: "insufficient", latest, comparison, worst: null };

  let worst: SeriesAssessment["worst"] = null;
  let best: SeriesAssessment["worst"] = null;
  for (const metric of ["open_rate", "ctr"] as const) {
    const base = weightedMean(prev, metric);
    if (base <= 0) continue;
    const sd = Math.max(stdev(prev.map((p) => p[metric])), base * 0.1, 0.3);
    const rel = (latest[metric] - base) / base;
    const z = (latest[metric] - base) / sd;
    if (!worst || z < worst.z) worst = { metric, z, rel };
    if (!best || z > best.z) best = { metric, z, rel };
  }

  let severity: Severity = "ok";
  if (worst && worst.rel <= -0.35 && worst.z <= -2) severity = "critical";
  else if (worst && worst.rel <= -0.2 && worst.z <= -1.5) severity = "warning";
  else if (best && best.rel >= 0.2 && best.z >= 1.5) severity = "positive";

  return { series, severity, latest, comparison, worst: severity === "positive" ? best : worst };
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, positive: 2, ok: 3, insufficient: 4 };

export function assessAll(series: Series[]): SeriesAssessment[] {
  return series
    .map(assessSeries)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.worst?.z ?? 0) - (b.worst?.z ?? 0));
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function fmtPct(v: number, digits = 1) {
  return `${v.toFixed(digits).replace(".", ",")}%`;
}

export function fmtDeltaPp(abs: number, digits = 1) {
  const sign = abs > 0 ? "+" : abs < 0 ? "−" : "";
  return `${sign}${Math.abs(abs).toFixed(digits).replace(".", ",")} p.p.`;
}

export function fmtRel(rel: number) {
  const sign = rel > 0 ? "+" : rel < 0 ? "−" : "";
  return `${sign}${Math.abs(rel * 100).toFixed(0)}%`;
}

export function parseSendDate(s: string): Date {
  return new Date(s.replace(" ", "T"));
}

// Plain-text summary to paste into a message or slide for the meeting.
export function buildMeetingSummary(title: string, c: Comparison): string {
  const l = c.latest;
  const date = parseSendDate(l.date).toLocaleDateString("pt-BR");
  const lines = [
    `${title}: disparo de ${date} (${l.sent.toLocaleString("pt-BR")} envios)`,
    `• Abertura: ${fmtPct(l.open_rate)} (média anterior ${fmtPct(c.baseline.open_rate)}, ${fmtDeltaPp(c.delta.open_rate.abs)})`,
    `• CTR: ${fmtPct(l.ctr, 2)} (média anterior ${fmtPct(c.baseline.ctr, 2)}, ${fmtDeltaPp(c.delta.ctr.abs, 2)})`,
    `• CTOR: ${fmtPct(l.ctor)} (média anterior ${fmtPct(c.baseline.ctor)}, ${fmtDeltaPp(c.delta.ctor.abs)})`,
    `• Bounce: ${fmtPct(l.bounce_rate, 2)} | Descadastro: ${fmtPct(l.unsub_rate, 2)}`,
    `Leitura: ${c.diagnosis.join(" ")}`,
    `Base de comparação: ${c.baselineCount} disparo(s) anterior(es), média ponderada por volume.`,
  ];
  if (c.warnings.length) lines.push(`Atenção: ${c.warnings.join(" ")}`);
  return lines.join("\n");
}
