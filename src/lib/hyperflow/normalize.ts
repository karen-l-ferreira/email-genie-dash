// Turns raw Hyperflow `chat/list-all` records (API response or imported JSON/CSV) into
// typed chats, without ever dropping a record silently: every rejection or gap is counted
// and surfaced in the dataset's quality report.

export type AuditInteraction = {
  agent: string | null;
  systemInteractions: number | null;
};

export type Chat = {
  id: string;
  protocol: string | null;
  status: string | null;
  createdAt: Date | null;
  finishedAt: Date | null;
  firstInteractionAt: Date | null;
  department: string | null; // primary (final) department
  departmentsAll: string[];
  agent: string | null; // final agent
  agentsAll: string[]; // every agent seen on the chat
  classifications: string[];
  labels: string[];
  queuedTime: number | null; // raw value, unit not yet validated
  userInteractionTime: number | null;
  systemInteractionTime: number | null;
  messagesCount: number | null;
  interactionsCount: number;
  transfers: number; // interactions carrying a transferAt
  isBroadcast: boolean;
  channel: string | null;
  channelKind: string | null; // provider channel, without human-readable alias
  createdByTeam: boolean; // createdBy relation is present: outbound/team-created
  possibleTest: boolean; // explicit contact/label test markers; audit still required
  auditInteractions: AuditInteraction[]; // per-interaction evidence, never message content
};

export type SourceInfo = { kind: "api" | "file"; label: string; records: number; at: Date };

export type Completeness = "complete" | "incomplete" | "unknown";

export type Dataset = {
  chats: Chat[]; // unique by _id
  rawCount: number; // records received, before dedupe/validation
  duplicates: number; // repeated _id (merged into one chat)
  invalidNoId: number; // records without _id (not countable as chats)
  sources: SourceInfo[];
  completeness: Completeness;
  incompleteReasons: string[];
  unknownReasons: string[];
  fieldCoverage: Record<string, number>; // documented field → records that carry it
  loadedAt: Date | null;
};

export const EMPTY_DATASET: Dataset = {
  chats: [],
  rawCount: 0,
  duplicates: 0,
  invalidNoId: 0,
  sources: [],
  completeness: "unknown",
  incompleteReasons: [],
  unknownReasons: [],
  fieldCoverage: {},
  loadedAt: null,
};

// Fields the API documents; used for the coverage table and to request only what we use.
export const DOCUMENTED_FIELDS = [
  "_id",
  "protocol",
  "status",
  "createdAt",
  "finishedAt",
  "agent.name",
  "department.name",
  "departments.name",
  "interactions.agent.name",
  "interactions.department.name",
  "interactions.transferAt",
  "interactions.systemInteractions",
  "createdBy.name",
  "contact.name",
  "classifications.name",
  "labels.name",
  "queuedTime",
  "firstInteractionAt",
  "messagesCount",
  "userInteractionTime",
  "systemInteractionTime",
  "isBroadcast",
  "channel",
  "channelAlias",
] as const;

// ── primitives ───────────────────────────────────────────────────────────────

export function nameOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object") {
    const n = (v as { name?: unknown }).name;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  return null;
}

export function namesOf(v: unknown): string[] {
  if (v == null) return [];
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : [v]) {
    const n = nameOf(x);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  let d: Date;
  if (v instanceof Date) d = v;
  else if (typeof v === "number") d = new Date(v < 1e11 ? v * 1000 : v);
  else if (typeof v === "string") {
    const s = v.trim();
    // dd/mm/yyyy[ hh:mm[:ss]] (Brazilian exports)
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    d = br ? new Date(+br[3], +br[2] - 1, +br[1], +(br[4] ?? 0), +(br[5] ?? 0), +(br[6] ?? 0)) : new Date(s);
  } else return null;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === "string" && ["true", "1", "sim", "yes"].includes(v.trim().toLowerCase()));
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown[] = [obj];
  for (const key of path.split(".")) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (c == null) continue;
      if (Array.isArray(c)) {
        for (const item of c) {
          const v = (item as Record<string, unknown> | null)?.[key];
          if (v != null) next.push(v);
        }
      } else if (typeof c === "object") {
        const v = (c as Record<string, unknown>)[key];
        if (v != null) next.push(v);
      }
    }
    cur = next;
    if (cur.length === 0) return undefined;
  }
  return cur.length === 1 ? cur[0] : cur;
}

function hasValue(v: unknown): boolean {
  if (v == null || v === "") return false;
  if (Array.isArray(v)) return v.some(hasValue);
  return true;
}

// ── record → Chat ────────────────────────────────────────────────────────────

export function normalizeChat(raw: Record<string, any>): Chat | null {
  const idRaw = raw?._id ?? raw?.id;
  if (idRaw == null || String(idRaw).trim() === "") return null;

  const interactions: any[] = Array.isArray(raw.interactions) ? raw.interactions : [];
  const interactionDepts = interactions.map((i) => nameOf(i?.department)).filter((x): x is string => !!x);
  const interactionAgents = interactions.map((i) => nameOf(i?.agent)).filter((x): x is string => !!x);
  const auditInteractions = interactions.map((i) => ({
    agent: nameOf(i?.agent),
    systemInteractions: toNum(i?.systemInteractions),
  }));
  const testMark = /(^|[^a-zA-Z])(?:teste|testes|test|homologacao|homologação)(?=$|[^a-zA-Z])/i;
  const possibleTest = [
    nameOf(raw?.contact),
    ...namesOf(raw?.labels),
  ].some((value) => value != null && testMark.test(value));

  const agent = nameOf(raw.agent);
  const department = nameOf(raw.department);
  const departmentsAll = [...new Set([...namesOf(raw.departments), ...(department ? [department] : []), ...interactionDepts])];
  const lastOf = (a: string[]) => (a.length ? a[a.length - 1] : null);

  return {
    id: String(idRaw),
    protocol: raw.protocol != null ? String(raw.protocol) : null,
    status: raw.status != null ? String(raw.status) : null,
    createdAt: toDate(raw.createdAt),
    finishedAt: toDate(raw.finishedAt),
    firstInteractionAt: toDate(raw.firstInteractionAt),
    department: department ?? lastOf(interactionDepts) ?? lastOf(namesOf(raw.departments)),
    departmentsAll,
    agent,
    agentsAll: [...new Set([...(agent ? [agent] : []), ...interactionAgents])],
    classifications: namesOf(raw.classifications),
    labels: namesOf(raw.labels),
    queuedTime: toNum(raw.queuedTime),
    userInteractionTime: toNum(raw.userInteractionTime),
    systemInteractionTime: toNum(raw.systemInteractionTime),
    messagesCount: toNum(raw.messagesCount),
    interactionsCount: interactions.length,
    transfers: interactions.filter((i) => hasValue(i?.transferAt)).length,
    isBroadcast: toBool(raw.isBroadcast),
    channel: nameOf(raw.channelAlias) ?? nameOf(raw.channel),
    channelKind: nameOf(raw.channel),
    createdByTeam: raw?.createdBy != null && raw?.createdBy !== "",
    possibleTest,
    auditInteractions,
  };
}

function richness(c: Chat): number {
  return [
    c.status, c.createdAt, c.finishedAt, c.firstInteractionAt, c.department, c.agent, c.queuedTime,
    c.messagesCount, c.channel, c.userInteractionTime, c.systemInteractionTime,
  ].filter((x) => x != null).length + c.classifications.length + c.agentsAll.length + c.interactionsCount
    + c.auditInteractions.filter((i) => i.systemInteractions != null).length;
}

// ── ingestion with deduplication and coverage ────────────────────────────────

export function ingest(
  prev: Dataset,
  docs: Record<string, any>[],
  source: Omit<SourceInfo, "records" | "at">,
  opts: { complete: Completeness; reasons?: string[] },
): Dataset {
  const byId = new Map(prev.chats.map((c) => [c.id, c]));
  let duplicates = prev.duplicates;
  let invalidNoId = prev.invalidNoId;
  const coverage = { ...prev.fieldCoverage };

  for (const f of DOCUMENTED_FIELDS) {
    coverage[f] = (coverage[f] ?? 0) + docs.filter((d) => hasValue(getPath(d, f))).length;
  }

  for (const raw of docs) {
    const chat = normalizeChat(raw);
    if (!chat) {
      invalidNoId++;
      continue;
    }
    const existing = byId.get(chat.id);
    if (existing) {
      duplicates++;
      if (richness(chat) > richness(existing)) byId.set(chat.id, chat);
    } else byId.set(chat.id, chat);
  }

  const sources = [...prev.sources, { ...source, records: docs.length, at: new Date() }];
  // A merged dataset is only as complete as its weakest source.
  const rank = { incomplete: 0, unknown: 1, complete: 2 } as const;
  const completeness: Completeness =
    prev.sources.length === 0 || rank[opts.complete] < rank[prev.completeness] ? opts.complete : prev.completeness;
  const reasons = opts.reasons ?? [];

  return {
    chats: [...byId.values()],
    rawCount: prev.rawCount + docs.length,
    duplicates,
    invalidNoId,
    sources,
    completeness,
    incompleteReasons: opts.complete === "incomplete" ? [...prev.incompleteReasons, ...reasons] : prev.incompleteReasons,
    unknownReasons: opts.complete === "unknown" ? [...prev.unknownReasons, ...reasons] : prev.unknownReasons,
    fieldCoverage: coverage,
    loadedAt: new Date(),
  };
}

// ── file import (JSON and CSV) ───────────────────────────────────────────────

export type ParsedFile = { docs: Record<string, any>[]; hasNextPage: boolean | null; format: "json" | "csv" };

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const ARRAY_ROOTS = new Set(["interactions", "classifications", "labels", "departments"]);

function splitList(v: string): string[] {
  return /[;|]/.test(v) ? v.split(/[;|]/).map((s) => s.trim()) : [v.trim()];
}

function setPath(obj: Record<string, any>, path: string[], value: unknown) {
  let cur = obj;
  path.slice(0, -1).forEach((k) => {
    if (typeof cur[k] !== "object" || cur[k] == null) cur[k] = {};
    cur = cur[k];
  });
  cur[path[path.length - 1]] = value;
}

// Flat columns such as "agent.name" or "classifications.name" become nested records.
// Several values in one cell are separated by ";" or "|" (aligned by position for interactions.*).
export function csvToDocs(rows: string[][]): Record<string, any>[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const doc: Record<string, any> = {};
    header.forEach((col, i) => {
      const value = (cells[i] ?? "").trim();
      if (!col || value === "") return;
      const path = col.split(".");
      if (ARRAY_ROOTS.has(path[0]) && path.length >= 2) {
        const arr: Record<string, any>[] = (doc[path[0]] ??= []);
        splitList(value).forEach((v, idx) => {
          arr[idx] ??= {};
          if (v !== "") setPath(arr[idx], path.slice(1), v);
        });
      } else setPath(doc, path, value);
    });
    return doc;
  });
}

export function parseFileText(name: string, text: string): ParsedFile {
  const trimmed = text.trim();
  const looksJson = /\.json$/i.test(name) || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksJson) {
    let data: any;
    try {
      data = JSON.parse(trimmed);
    } catch {
      // JSON Lines fallback
      const lines = trimmed.split(/\r?\n/).filter(Boolean);
      try {
        data = lines.map((l) => JSON.parse(l));
      } catch {
        throw new Error("O arquivo não é um JSON válido.");
      }
    }
    const docs = Array.isArray(data) ? data : (data?.docs ?? data?.data?.docs ?? null);
    if (!Array.isArray(docs)) throw new Error('Não encontrei a lista de atendimentos. Esperava uma lista ou um objeto com a chave "docs".');
    const hasNext = !Array.isArray(data) && typeof data?.hasNextPage === "boolean" ? data.hasNextPage : null;
    return { docs: docs.filter((d) => d && typeof d === "object"), hasNextPage: hasNext, format: "json" };
  }
  const rows = parseCsv(trimmed);
  if (rows.length < 2) throw new Error("O CSV precisa ter uma linha de cabeçalho e ao menos um atendimento.");
  return { docs: csvToDocs(rows), hasNextPage: null, format: "csv" };
}
