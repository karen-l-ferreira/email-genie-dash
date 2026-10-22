import type { Dataset } from "./normalize";
import { messageEvidence } from "./human-impact";
import { norm } from "./metrics";

export type TrendPeriod = {
  start: string;
  end: string;
  eligible: number;
  withHumanMessage: number;
  withoutHumanMessage: number;
  unknown: number;
};
export type LiveHumanTrend = {
  before: TrendPeriod;
  current: TrendPeriod;
  ready: boolean;
  changePercent: number | null;
  participationChangePp: number | null;
  reason: string | null;
  updatedAt: Date | null;
};

// The last 30 FULL local calendar days versus the 30 days before that.
// No historical snapshot or fixed baseline is ever used.
export function calculateLiveHumanTrend(
  dataset: Dataset,
  botNames: string[],
  now = new Date(),
): LiveHumanTrend {
  const day = (d: Date) => {
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  // Use noon UTC to prevent timezone edge cases when computing calendar days.
  const anchorDay = day(now);
  const atNoonUTC = (ymd: string) => new Date(ymd + "T12:00:00Z");
  const shift = (ymd: string, offset: number) => {
    const d = atNoonUTC(ymd);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const beforeStart = shift(anchorDay, -60);
  const currentStart = shift(anchorDay, -30);
  const lastCompleted = shift(anchorDay, -1);
  const before: TrendPeriod = {
    start: beforeStart, end: shift(currentStart, -1),
    eligible: 0, withHumanMessage: 0, withoutHumanMessage: 0, unknown: 0,
  };
  const current: TrendPeriod = {
    start: currentStart, end: lastCompleted,
    eligible: 0, withHumanMessage: 0, withoutHumanMessage: 0, unknown: 0,
  };

  // Distinguish a confirmed complete API extraction covering BOTH windows
  // from a file import or a partial/older extraction. Never infer full
  // coverage from the minimum/maximum date of returned chats.
  const coversBoth = dataset.completeness === "complete" && dataset.sources.some((s) => {
    if (s.kind !== "api") return false;
    const range = s.label.match(/API Hyperflow\s*·\s*(\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2})/);
    return range != null && range[1] <= beforeStart && range[2] >= lastCompleted;
  });

  for (const chat of dataset.chats) {
    if (!chat.createdAt) continue;
    const when = day(chat.createdAt);
    const period = when >= beforeStart && when < currentStart
      ? before : when >= currentStart && when < anchorDay ? current : null;
    if (!period) continue;
    if (!norm(chat.channelKind || chat.channel || "").includes("whatsapp")) continue;
    if (chat.isBroadcast || chat.createdByTeam || chat.possibleTest) continue;

    period.eligible++;
    const evidence = messageEvidence(chat, botNames);
    if (evidence === "human") period.withHumanMessage++;
    else if (evidence === "without-human") period.withoutHumanMessage++;
    else period.unknown++;
  }

  let reason: string | null = null;
  if (!coversBoth) reason = "A extração não cobre os dois períodos completos de 30 dias.";
  else if (before.eligible === 0 || current.eligible === 0)
    reason = "Ainda não há atendimentos receptivos suficientes nos dois períodos.";
  else if (before.unknown > 0 || current.unknown > 0)
    reason = `A Hyperflow não confirmou as mensagens de ${before.unknown + current.unknown} atendimentos. Não é possível afirmar uma redução total.`;
  else if (before.withHumanMessage === 0)
    reason = "Não houve atendimentos humanos confirmados na janela anterior para calcular a variação.";

  const ready = reason == null;
  const changePercent = ready
    ? ((current.withHumanMessage - before.withHumanMessage) / before.withHumanMessage) * 100
    : null;
  const participationChangePp = ready
    ? (current.withHumanMessage / current.eligible - before.withHumanMessage / before.eligible) * 100
    : null;
  return { before, current, ready, changePercent, participationChangePp, reason, updatedAt: dataset.loadedAt };
}
