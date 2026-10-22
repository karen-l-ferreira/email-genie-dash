import type { Chat } from "./normalize";
import { norm } from "./metrics";

// Historical study: both windows include 19 calendar days.
// Keep its audit snapshot separate from fresh API-derived measurements.
export const HISTORICAL_HUMAN_IMPACT = {
  extractedAt: "2026-10-20",
  before: { from: "2026-09-12", to: "2026-09-30", eligible: 277, human: 195 },
  after: { from: "2026-10-01", to: "2026-10-19", eligible: 277, human: 162 },
  openOrPending: 51,
} as const;

export type MessageEvidence = "human" | "without-human" | "unknown";

export type PeriodAudit = {
  eligible: number;
  human: number;
  withoutHuman: number;
  unknown: number;
  excludedBroadcast: number;
  excludedTeamCreated: number;
  excludedTests: number;
  excludedOtherChannel: number;
  pending: number;
};

export type ImpactAudit = {
  before: PeriodAudit;
  after: PeriodAudit;
  coverageOfWindows: boolean;
  isComplete: boolean;
  reconcilesStudy: boolean;
  eligibleForComparison: boolean;
  deltaHuman: number | null;
  deltaRate: number | null;
  deltaParticipationPp: number | null;
};

const empty = (): PeriodAudit => ({
  eligible: 0, human: 0, withoutHuman: 0, unknown: 0,
  excludedBroadcast: 0, excludedTeamCreated: 0, excludedTests: 0,
  excludedOtherChannel: 0, pending: 0,
});

const INACTIVE_STATUSES = new Set(["queued", "active", "hold", "overdue", "inactivity", "unsolved"]);

// A human agent being assigned to a protocol is NOT proof they sent a message.
// The study counted positive per-interaction systemInteractions from human agents.
export function messageEvidence(chat: Chat, botNames: string[]): MessageEvidence {
  if (chat.auditInteractions.length === 0) return "unknown";
  const bots = [...new Set(["Duda", "Ada", ...botNames])].map(norm).filter(Boolean);
  const isBot = (name: string) => bots.some((b) => norm(name) === b || (b.length >= 4 && norm(name).includes(b)));

  let unknown = false;
  for (const interaction of chat.auditInteractions) {
    if (interaction.systemInteractions == null) {
      unknown = true;
      continue;
    }
    if (interaction.systemInteractions <= 0) continue;
    if (!interaction.agent) {
      unknown = true;
      continue;
    }
    if (!isBot(interaction.agent)) return "human";
  }
  return unknown ? "unknown" : "without-human";
}

// Recomputes only when the data includes verified message counts and both full
// periods were fetched. Its eligible filter is transparent and may still differ
// from manually audited exclusions in the original study.
export function analyzeHistoricalHumanImpact(
  chats: Chat[],
  botNames: string[],
  extractionComplete: boolean,
): ImpactAudit {
  const before = empty();
  const after = empty();
  const earliest = chats.map((c) => c.createdAt?.getTime()).filter((v): v is number => v != null);
  const coverageOfWindows = earliest.length > 0
    && Math.min(...earliest) <= new Date("2026-09-12T23:59:59").getTime()
    && Math.max(...earliest) >= new Date("2026-10-19T00:00:00").getTime();

  for (const chat of chats) {
    if (!chat.createdAt) continue;
    // ISO dates in a fixed Brazilian local timezone avoid UTC midnight shifts.
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(chat.createdAt);
    const p = date >= HISTORICAL_HUMAN_IMPACT.before.from && date <= HISTORICAL_HUMAN_IMPACT.before.to
      ? before
      : date >= HISTORICAL_HUMAN_IMPACT.after.from && date <= HISTORICAL_HUMAN_IMPACT.after.to ? after : null;
    if (!p) continue;

    const channel = norm(chat.channelKind || chat.channel || "");
    if (!channel.includes("whatsapp")) {
      p.excludedOtherChannel++;
      continue;
    }
    if (chat.isBroadcast) {
      p.excludedBroadcast++;
      continue;
    }
    if (chat.createdByTeam) {
      p.excludedTeamCreated++;
      continue;
    }
    if (chat.possibleTest) {
      p.excludedTests++;
      continue;
    }

    p.eligible++;
    if (INACTIVE_STATUSES.has(norm(chat.status || ""))) p.pending++;
    const evidence = messageEvidence(chat, botNames);
    if (evidence === "human") p.human++;
    else if (evidence === "without-human") p.withoutHuman++;
    else p.unknown++;
  }

  const isComplete = extractionComplete && coverageOfWindows;
  const reconcilesStudy = before.eligible === HISTORICAL_HUMAN_IMPACT.before.eligible
    && after.eligible === HISTORICAL_HUMAN_IMPACT.after.eligible;
  const eligibleForComparison = isComplete && before.eligible > 0 && after.eligible > 0
    && before.unknown === 0 && after.unknown === 0 && reconcilesStudy;

  return {
    before, after, coverageOfWindows, isComplete, reconcilesStudy, eligibleForComparison,
    deltaHuman: eligibleForComparison ? after.human - before.human : null,
    deltaRate: eligibleForComparison && before.human > 0 ? (after.human - before.human) / before.human : null,
    deltaParticipationPp: eligibleForComparison
      ? ((after.human / after.eligible) - (before.human / before.eligible)) * 100 : null,
  };
}
