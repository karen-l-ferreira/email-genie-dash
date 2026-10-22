import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchHyperflowPage, getHyperflowStatus } from "@/lib/hyperflow.functions";
import type { AuditBaseline } from "@/lib/hyperflow/audit-reconcile";
import { EMPTY_DATASET, ingest, parseFileText, type Completeness, type Dataset } from "@/lib/hyperflow/normalize";
import {
  DEFAULT_CONFIG,
  DEFAULT_DEPARTMENTS,
  EXCLUDED_BY_DEFAULT,
  applyFilters,
  computeKpis,
  detectTimeUnit,
  endOfDay,
  enrich,
  granularityFor,
  norm,
  previousRange,
  startOfDay,
  type Config,
  type Filters,
  type Granularity,
  type Kpis,
  type Row,
  type ScopeStats,
} from "@/lib/hyperflow/metrics";

// Everything lives in memory. Customer data is never written to localStorage, the database
// or the URL; only the non-sensitive analysis settings (Duda's name, resolution marker,
// confirmed time unit) are remembered in this browser.

export type Preset = "7" | "30" | "90" | "all" | "custom";

export type SyncState = {
  running: boolean;
  pages: number;
  docs: number;
  message: string | null; // last outcome, success or failure
  failed: boolean;
};

export type ImportLog = { name: string; ok: boolean; message: string };

export type DeptOption = { name: string; inDefault: boolean; comercial: boolean };

type Store = {
  dataset: Dataset;
  auditBaseline: AuditBaseline | null;
  setAuditBaseline: (next: AuditBaseline | null) => void;
  clear: () => void;
  config: Config;
  setConfig: (p: Partial<Config>) => void;
  rows: Row[];
  filters: Filters;
  setFilters: (p: Partial<Filters>) => void;
  preset: Preset;
  setPreset: (p: Preset) => void;
  dataMin: Date | null;
  dataMax: Date | null;
  deptOptions: DeptOption[];
  agentOptions: string[];
  classificationOptions: string[];
  scoped: { operational: Row[]; campaigns: Row[]; stats: ScopeStats };
  prev: { range: { start: Date; end: Date }; rows: Row[]; kpis: Kpis; covered: boolean };
  kpis: Kpis;
  granularity: Granularity;
  hasKey: boolean | undefined;
  sync: SyncState;
  startSync: (start: Date, end: Date, fullAudit?: boolean) => Promise<void>;
  refreshNow: () => Promise<void>;
  importLog: ImportLog[];
  importFiles: (files: File[]) => Promise<void>;
  timeUnitSuggestion: ReturnType<typeof detectTimeUnit>;
};

const Ctx = createContext<Store | null>(null);

export function useAtendimento(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAtendimento fora do provedor");
  return v;
}

const CONFIG_KEY = "fluxi_atendimento_config";
const MAX_PAGES = 600;

function readConfig(): Config {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: defaults apply */
  }
  return DEFAULT_CONFIG;
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function friendly(msg: string): string {
  if (msg.includes("HYPERFLOW_AUTH")) return "chave recusada pela Hyperflow";
  if (msg.includes("HYPERFLOW_NOT_CONFIGURED")) return "chave não configurada no servidor";
  const [head, body = "", tried = ""] = msg.split("|");
  const detail = body.trim() ? ` Resposta da Hyperflow: "${body.trim()}".` : "";
  if (head.includes("HYPERFLOW_BAD_REQUEST")) return `requisição recusada pela Hyperflow.${detail}`;
  const m = head.match(/HYPERFLOW_FAILED_(\d+)/);
  if (m) {
    if (m[1] === "0") return "sem resposta da Hyperflow após novas tentativas";
    return `erro ${m[1]}${tried === "retried" ? " após novas tentativas" : ""}.${detail}`;
  }
  return "erro inesperado";
}

export function AtendimentoProvider({ children }: { children: ReactNode }) {
  const fetchStatus = useServerFn(getHyperflowStatus);
  const fetchPage = useServerFn(fetchHyperflowPage);
  const statusQ = useQuery({ queryKey: ["hyperflow-status"], queryFn: () => fetchStatus(), staleTime: 10 * 60 * 1000 });

  const [dataset, setDataset] = useState<Dataset>(EMPTY_DATASET);
  const [auditBaseline, setAuditBaseline] = useState<AuditBaseline | null>(null);
  const [config, setConfigState] = useState<Config>(() => readConfig());
  const [sync, setSync] = useState<SyncState>({ running: false, pages: 0, docs: 0, message: null, failed: false });
  const [importLog, setImportLog] = useState<ImportLog[]>([]);
  const [preset, setPresetState] = useState<Preset>("30");
  const [filters, setFiltersState] = useState<Filters>(() => {
    const end = endOfDay(new Date());
    return { start: startOfDay(new Date(end.getTime() - 29 * 86400000)), end, departments: [], agent: null, classification: null, includeCampaigns: false };
  });
  const initialized = useRef(false);
  const syncBusy = useRef(false);
  const autoStarted = useRef(false);

  const setConfig = useCallback((p: Partial<Config>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      } catch {
        /* the setting still applies for this visit */
      }
      return next;
    });
  }, []);

  const setFilters = useCallback((p: Partial<Filters>) => setFiltersState((f) => ({ ...f, ...p })), []);

  const rows = useMemo(() => enrich(dataset.chats, config), [dataset.chats, config]);

  const { dataMin, dataMax } = useMemo(() => {
    let min: Date | null = null;
    let max: Date | null = null;
    for (const c of dataset.chats) {
      if (!c.createdAt) continue;
      if (!min || c.createdAt < min) min = c.createdAt;
      if (!max || c.createdAt > max) max = c.createdAt;
    }
    return { dataMin: min, dataMax: max };
  }, [dataset.chats]);

  const deptOptions = useMemo<DeptOption[]>(() => {
    const names = [...new Set(rows.map((r) => r.dept).filter((d): d is string => !!d))];
    const opt = (name: string): DeptOption => ({
      name,
      inDefault: DEFAULT_DEPARTMENTS.includes(norm(name)),
      comercial: norm(name) === EXCLUDED_BY_DEFAULT,
    });
    const rank = (o: DeptOption) => (o.inDefault ? 0 : o.comercial ? 1 : 2);
    return names.map(opt).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "pt-BR"));
  }, [rows]);

  const setPreset = useCallback(
    (p: Preset) => {
      setPresetState(p);
      if (p === "custom") return;
      const anchor = dataMax ?? new Date();
      const end = endOfDay(anchor);
      const start = p === "all" ? (dataMin ? startOfDay(dataMin) : startOfDay(anchor)) : startOfDay(new Date(end.getTime() - (Number(p) - 1) * 86400000));
      setFiltersState((f) => ({ ...f, start, end }));
    },
    [dataMin, dataMax],
  );

  // First data load: anchor the period on the newest chat and select the in-scope departments.
  useEffect(() => {
    if (dataset.chats.length === 0) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    initialized.current = true;
    setPreset("30");
    setFiltersState((f) => ({ ...f, departments: deptOptions.filter((d) => d.inDefault).map((d) => d.name) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.chats.length, deptOptions]);

  const scoped = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const kpis = useMemo(() => computeKpis(scoped.operational), [scoped.operational]);
  const granularity = useMemo(() => granularityFor(filters.start, filters.end), [filters.start, filters.end]);

  const prev = useMemo(() => {
    const range = previousRange(filters.start, filters.end);
    const r = applyFilters(rows, { ...filters, ...range }).operational;
    const covered = dataMin != null && dataMin.getTime() <= range.start.getTime() + 86400000;
    return { range, rows: r, kpis: computeKpis(r), covered };
  }, [rows, filters, dataMin]);

  // Keep available options stable while an agent or classification is selected.
  // The period, departments and campaign choices still constrain the options.
  const optionRows = useMemo(
    () => applyFilters(rows, { ...filters, agent: null, classification: null }).operational,
    [rows, filters],
  );
  const agentOptions = useMemo(
    () => [...new Set(optionRows.flatMap((r) => r.agentsAll))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [optionRows],
  );
  const classificationOptions = useMemo(
    () => [...new Set(optionRows.flatMap((r) => r.classifications))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [optionRows],
  );

  const timeUnitSuggestion = useMemo(() => detectTimeUnit(dataset.chats), [dataset.chats]);

  const clear = useCallback(() => {
    setDataset(EMPTY_DATASET);
    setImportLog([]);
    setSync({ running: false, pages: 0, docs: 0, message: null, failed: false });
  }, []);

  const startSync = useCallback(
    async (start: Date, end: Date, fullAudit = false) => {
      if (syncBusy.current) return;
      syncBusy.current = true;
      try {
      setSync({ running: true, pages: 0, docs: 0, message: null, failed: false });
      const docs: Record<string, any>[] = [];
      const reasons: string[] = [];
      let complete: Completeness = "complete";
      let page = 1;
      let pages = 0;
      let rateLimitRetries = 0;
      let pacingMs = 1000;
      const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      // The API's accepted request shape is not documented. If the very first page is refused
      // (400/422/500), try progressively simpler requests before giving up.
      const MODES = [
        { useFields: true, dateFormat: "ymd", limit: 100, note: "" },
        { useFields: false, dateFormat: "ymd", limit: 100, note: "sem seleção de campos" },
        { useFields: false, dateFormat: "iso", limit: 100, note: "sem seleção de campos, datas em ISO" },
        { useFields: false, dateFormat: "ymd", limit: 25, note: "sem seleção de campos, páginas de 25" },
      ] as const;
      let modeIdx = 0;
      // The API may treat endDate as exclusive: ask for one extra day and re-filter on createdAt later.
      const endPlus = new Date(end.getTime() + 86400000);
      for (;;) {
        try {
          const mode = MODES[modeIdx];
          const res = await fetchPage({
            data: { startDate: ymd(start), endDate: ymd(endPlus), page, limit: mode.limit, useFields: fullAudit ? false : mode.useFields, dateFormat: mode.dateFormat },
          });
          docs.push(...res.docs);
          pages++;
          rateLimitRetries = 0;
          setSync((s) => ({ ...s, pages, docs: docs.length, message: null }));
          if (!res.hasNextPage) break;
          page = res.nextPage ?? page + 1;
          if (pages >= MAX_PAGES) {
            complete = "incomplete";
            reasons.push(`Limite de ${MAX_PAGES} páginas atingido: há páginas não carregadas.`);
            break;
          }
          // Sequential pacing reduces the likelihood of triggering the provider's rate limit.
          await wait(pacingMs);
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          const rateLimit = msg.match(/HYPERFLOW_RATE_LIMIT\|(\d+)/);
          if (rateLimit && rateLimitRetries < 8) {
            rateLimitRetries++;
            const seconds = Math.min(300, Math.max(1, Number(rateLimit[1]) || 60));
            pacingMs = 16000;
            setSync((s) => ({
              ...s,
              message: `Limite de requisições da Hyperflow. Aguardando ${seconds} segundos antes de tentar novamente a página ${page} (tentativa ${rateLimitRetries}/8). Não feche esta aba.`,
            }));
            await wait((seconds + 2) * 1000);
            continue;
          }
          if (page === 1 && modeIdx < MODES.length - 1 && /HYPERFLOW_(BAD_REQUEST|FAILED_(400|422|500))/.test(msg)) {
            modeIdx++;
            continue;
          }
          complete = "incomplete";
          reasons.push(rateLimit
            ? `A página ${page} atingiu repetidamente o limite de requisições da Hyperflow. Sincronize novamente mais tarde.`
            : `A página ${page} não foi carregada (${friendly(msg)}). As páginas a partir dela ficaram de fora.`);
          break;
        }
      }
      // A total failure loads nothing: keep whatever was on screen instead of replacing it with an empty base.
      const nothingLoaded = docs.length === 0 && complete === "incomplete";
      if (!nothingLoaded) {
        setDataset(ingest(EMPTY_DATASET, docs, { kind: "api", label: `API Hyperflow · ${ymd(start)} a ${ymd(end)}` }, { complete, reasons }));
      }
      const how = MODES[modeIdx].note ? ` (pedido ${MODES[modeIdx].note})` : "";
      setSync({
        running: false,
        pages,
        docs: docs.length,
        failed: complete === "incomplete",
        message:
          complete === "incomplete"
            ? `${nothingLoaded ? "Nada foi carregado" : "Extração incompleta"}: ${docs.length.toLocaleString("pt-BR")} registros em ${pages} página(s). ${reasons.join(" ")}`
            : `Extração completa: ${docs.length.toLocaleString("pt-BR")} registros em ${pages} página(s)${fullAudit ? " (histórico completo solicitado, sem seleção de campos)" : how}. ${fullAudit && !docs.some((d: any) => Array.isArray(d.interactions) && d.interactions.some((i: any) => i && Object.prototype.hasOwnProperty.call(i, "systemInteractions"))) ? "A API não forneceu contadores systemInteractions nas interações; a auditoria pode continuar sem evidência." : ""}`,
      });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : "Erro inesperado";
        setSync((old) => ({ ...old, running: false, failed: true, message: "Falha ao sincronizar: " + detail }));
      } finally {
        syncBusy.current = false;
      }
    },
    [fetchPage],
  );

  const refreshNow = useCallback(() => {
    // 30 full days + 30 preceding days, plus today for future comparisons.
    const now = new Date();
    const start = startOfDay(now);
    start.setDate(start.getDate() - 60);
    return startSync(start, endOfDay(now), true);
  }, [startSync]);

  useEffect(() => {
    if (statusQ.data?.configured !== true || autoStarted.current) return;
    autoStarted.current = true;
    void refreshNow();
  }, [statusQ.data?.configured, refreshNow]);

  useEffect(() => {
    if (statusQ.data?.configured !== true) return;
    // While the dashboard is open, refresh every six hours.
    // Data is not persisted or refreshed when no browser session is running.
    const interval = window.setInterval(() => { void refreshNow(); }, 6 * 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [statusQ.data?.configured, refreshNow]);

  const importFiles = useCallback(async (files: File[]) => {
    const log: ImportLog[] = [];
    for (const file of files) {
      try {
        const parsed = parseFileText(file.name, await file.text());
        const complete: Completeness = parsed.hasNextPage === true ? "incomplete" : "unknown";
        const reason =
          parsed.hasNextPage === true
            ? `O arquivo ${file.name} indica que existem mais páginas (hasNextPage = true) que não foram exportadas.`
            : `Importação manual de ${file.name}: não há como confirmar que todos os atendimentos do período foram exportados.`;
        setDataset((d) => ingest(d, parsed.docs, { kind: "file", label: file.name }, { complete, reasons: [reason] }));
        log.push({ name: file.name, ok: true, message: `${parsed.docs.length.toLocaleString("pt-BR")} registros lidos (${parsed.format.toUpperCase()}).` });
      } catch (e: any) {
        log.push({ name: file.name, ok: false, message: e?.message ?? "Não consegui ler o arquivo." });
      }
    }
    setImportLog(log);
  }, []);

  const value: Store = {
    dataset, auditBaseline, setAuditBaseline, clear, config, setConfig, rows, filters, setFilters, preset, setPreset, dataMin, dataMax,
    deptOptions, agentOptions, classificationOptions, scoped, prev, kpis, granularity,
    hasKey: statusQ.data?.configured, sync, startSync, refreshNow, importLog, importFiles, timeUnitSuggestion,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
