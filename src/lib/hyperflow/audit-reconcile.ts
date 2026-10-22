import type { Chat } from "./normalize";
import { messageEvidence } from "./human-impact";

// A protocol-level audit is loaded explicitly by the user and kept only in memory.
// No customer/protocol identifiers are committed to the repository.
export type AuditRecord = {
  protocol: string;
  period: "before" | "after";
  eligible: boolean;
  test: boolean;
  campaign: boolean;
  team: boolean;
  humanMessage: boolean;
  pending: boolean;
  status: string;
};
export type AuditBaseline = {
  schema: "fluxi-human-audit-v1";
  referenceDate: string;
  records: AuditRecord[];
};
type WindowTotals = {
  eligible: number;
  humanAtSnapshot: number;
  matched: number;
  humanNow: number;
  withoutHumanNow: number;
  noMessageEvidence: number;
  absent: number;
  stillOpen: number;
  statusUnknown: number;
  originalPending: number;
  originalPendingClosed: number;
  newHumanSinceSnapshot: number;
};
export type AuditReconciliation = {
  before: WindowTotals;
  after: WindowTotals;
  baseMatched: boolean;
  complete: boolean;
  final: boolean; // fully verifiable as of extraction; open cases are allowed
  reductionPercent: number | null; // only if every eligible protocol has message evidence
  observedDifferencePercent: number | null; // comparison of *minimum proven counts* (not a full reduction)
  evidenceCoverage: number;
  unknownCases: number;
  humanShareBefore: number | null;
  humanShareAfter: number | null;
  deltaParticipationPp: number | null;
  unmatchedCurrentProtocols: number;
  duplicateProtocols: number;
};

function cleanRecord(x: unknown): AuditRecord {
  if (!x || typeof x !== "object") throw new Error("Registro de auditoria inválido.");
  const r = x as Record<string, unknown>;
  if (typeof r.protocol !== "string" || !/^\d{6,25}$/.test(r.protocol)) throw new Error("Protocolo inválido na auditoria.");
  if (r.period !== "before" && r.period !== "after") throw new Error("Período inválido na auditoria.");
  for (const k of ["eligible", "test", "campaign", "team", "humanMessage", "pending"]) {
    if (typeof r[k] !== "boolean") throw new Error("Campo " + k + " inválido na auditoria.");
  }
  return {
    protocol: r.protocol, period: r.period,
    eligible: r.eligible as boolean,
    test: r.test as boolean, campaign: r.campaign as boolean,
    team: r.team as boolean, humanMessage: r.humanMessage as boolean,
    pending: r.pending as boolean, status: typeof r.status === "string" ? r.status : "",
  };
}

export function parseAuditBaseline(text: string): AuditBaseline {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new Error("O arquivo precisa estar em JSON válido."); }
  const source = obj as Partial<AuditBaseline> | null;
  if (!source || source.schema !== "fluxi-human-audit-v1" || !Array.isArray(source.records)) {
    throw new Error("Arquivo incompatível. Carregue a auditoria de protocolos do Hyperflow.");
  }
  if (source.records.length !== 1380) throw new Error("Auditoria incompleta: eram esperados 1.380 registros da extração de 20/10.");
  const records = source.records.map(cleanRecord);
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.protocol)) throw new Error("Há protocolos duplicados no arquivo.");
    seen.add(r.protocol);
  }
  const eligible = (p: "before" | "after") => records.filter((r) => r.period === p && r.eligible);
  const before = eligible("before"), after = eligible("after");
  if (before.length !== 277 || after.length !== 277 ||
    before.filter((r) => r.humanMessage).length !== 195 ||
    after.filter((r) => r.humanMessage).length !== 164 ||
    after.filter((r) => r.pending).length !== 51) {
    throw new Error("A auditoria não confere com a planilha detalhada: 277/277 elegíveis, 195/164 com humano e 51 pendentes.");
  }
  return { schema: "fluxi-human-audit-v1", referenceDate: source.referenceDate ?? "2026-10-20", records };
}

const stillOpen = new Set(["active", "overdue", "hold", "queued"]);
const empty = (): WindowTotals => ({
  eligible: 0, humanAtSnapshot: 0, matched: 0, humanNow: 0,
  withoutHumanNow: 0, noMessageEvidence: 0, absent: 0, stillOpen: 0,
  statusUnknown: 0, originalPending: 0, originalPendingClosed: 0, newHumanSinceSnapshot: 0,
});

export function reconcileAudit(
  baseline: AuditBaseline,
  chats: Chat[],
  botNames: string[],
  extractionComplete: boolean,
): AuditReconciliation {
  const current = new Map<string, Chat>();
  const auditIds = new Set(baseline.records.map((r) => r.protocol));
  let duplicateProtocols = 0;
  for (const chat of chats) {
    if (!chat.protocol) continue;
    if (current.has(chat.protocol) && auditIds.has(chat.protocol)) duplicateProtocols++;
    else current.set(chat.protocol, chat);
  }
  const before = empty(), after = empty();
  for (const r of baseline.records) {
    if (!r.eligible) continue;
    const totals = r.period === "before" ? before : after;
    totals.eligible++;
    if (r.humanMessage) totals.humanAtSnapshot++;
    if (r.pending) totals.originalPending++;
    const chat = current.get(r.protocol);
    if (!chat) { totals.absent++; continue; }
    totals.matched++;
    const open = stillOpen.has((chat.status ?? "").toLowerCase());
    if (open) totals.stillOpen++;
    if (!chat.status) totals.statusUnknown++;
    if (r.pending && !open && chat.status) totals.originalPendingClosed++;

    // Once a message was observed in the original audit, it is established
    // evidence. But no-message cases must be rechecked from today's interaction counts.
    const evidence = messageEvidence(chat, botNames);
    if (r.humanMessage || evidence === "human") {
      totals.humanNow++;
      if (!r.humanMessage && evidence === "human") totals.newHumanSinceSnapshot++;
    } else if (evidence === "without-human") {
      totals.withoutHumanNow++;
    } else {
      totals.noMessageEvidence++;
    }
  }

  const baseMatched = before.eligible === 277 && after.eligible === 277;
  const complete = extractionComplete && baseMatched &&
    before.absent === 0 && after.absent === 0 && duplicateProtocols === 0;
  // At a fixed extraction cut-off, open protocols may be analysed as they stand.
  // They remain a separate, visible maturity caveat, not a reason to hide all data.
  // A confirmed cohort-wide reduction still REQUIRES every eligible record to
  // have verifiable message evidence, even when some protocols are open.
  const unknownCases = before.noMessageEvidence + after.noMessageEvidence;
  const final = complete && unknownCases === 0 &&
    before.statusUnknown === 0 && after.statusUnknown === 0 && before.humanNow > 0;
  const rateBefore = final ? before.humanNow / before.eligible : null;
  const rateAfter = final ? after.humanNow / after.eligible : null;
  // Always report the proven message counts, even when evidence coverage is
  // incomplete. Their difference is NOT a confirmed reduction in total human work.
  const observedDifferencePercent = complete && before.humanNow > 0
    ? ((before.humanNow - after.humanNow) / before.humanNow) * 100 : null;
  const evidenceCoverage = (before.eligible + after.eligible) > 0
    ? (before.eligible + after.eligible - unknownCases) / (before.eligible + after.eligible)
    : 0;
  return {
    before, after, baseMatched, complete, final, unknownCases, evidenceCoverage, observedDifferencePercent,
    reductionPercent: final ? observedDifferencePercent : null,
    humanShareBefore: rateBefore, humanShareAfter: rateAfter,
    deltaParticipationPp: final && rateBefore != null && rateAfter != null ? (rateAfter - rateBefore) * 100 : null,
    unmatchedCurrentProtocols: chats.filter((c) => !!c.protocol && !auditIds.has(c.protocol)).length,
    duplicateProtocols,
  };
}
