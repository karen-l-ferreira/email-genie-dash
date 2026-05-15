import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listContactFields,
  listContactsForAnalysis,
  listCampaigns,
  type ContactSummary,
  type Campaign,
} from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  Clock,
  Download,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInMinutes, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/influencia")({
  ssr: false,
  component: () => (
    <AuthGate>
      <InfluenciaPage />
    </AuthGate>
  ),
});

const ATTR_WINDOWS = [
  { value: 30, label: "30min" },
  { value: 60, label: "1h" },
  { value: 120, label: "2h" },
  { value: 240, label: "4h" },
  { value: 1440, label: "1 dia" },
  { value: 4320, label: "3 dias" },
];

type InfluenceStatus = "influenced" | "not_influenced" | "no_operation";

type ContactRow = {
  contact: ContactSummary;
  rawValue: string | undefined;
  operationDate: Date | null;
  isDateOnly: boolean; // field stores date only, no time
  closestCampaign: Campaign | null;
  minutesDelta: number | null;
  daysDelta: number | null;
  status: InfluenceStatus;
};

function parseDateSafe(s: string | undefined | null): Date | null {
  if (!s || s.startsWith("0000") || s.trim() === "") return null;
  // Try ISO date-only format "YYYY-MM-DD"
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

// Detect if a raw AC date value is date-only (no meaningful time)
function isDateOnlyValue(s: string): boolean {
  if (!s) return false;
  // Pure date "2024-05-14"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return true;
  // Datetime with midnight time "2024-05-14 00:00:00" or "2024-05-14T00:00:00"
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(s.trim())) {
    const timePart = s.replace(/^\d{4}-\d{2}-\d{2}[T ]/, "");
    return timePart === "00:00:00";
  }
  return false;
}

function fmtDelta(row: ContactRow): string {
  if (row.isDateOnly && row.daysDelta !== null) {
    return row.daysDelta === 0 ? "mesmo dia" : `${row.daysDelta}d`;
  }
  if (row.minutesDelta !== null) {
    const m = row.minutesDelta;
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? `${h}h` : `${h}h ${rem}min`;
  }
  return "—";
}

function exportInfluenceCSV(rows: ContactRow[]) {
  const header = ["Nome", "E-mail", "Data/hora da operação", "Campanha mais próxima", "Envio da campanha", "Δ tempo", "Status"];
  const data = rows.map((r) => [
    `"${[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ").replace(/"/g, '""') || ""}"`,
    r.contact.email,
    r.operationDate ? format(r.operationDate, "dd/MM/yyyy HH:mm") : "",
    r.closestCampaign ? `"${r.closestCampaign.name.replace(/"/g, '""')}"` : "",
    r.closestCampaign?.sdate ? format(new Date(r.closestCampaign.sdate.replace(" ", "T")), "dd/MM/yyyy HH:mm") : "",
    fmtDelta(r),
    r.status === "influenced" ? "Influenciado" : r.status === "not_influenced" ? "Não influenciado" : "Sem operação",
  ]);
  const csv = [header, ...data].map((r) => r.join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `influencia_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function InfluenciaPage() {
  const fetchSettings = useServerFn(getSettings);
  const fetchFields = useServerFn(listContactFields);
  const fetchContacts = useServerFn(listContactsForAnalysis);
  const fetchCampaigns = useServerFn(listCampaigns);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const fieldsQ = useQuery({
    queryKey: ["contact-fields"],
    queryFn: () => fetchFields(),
    enabled: !!settingsQ.data?.hasApiKey,
  });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", 0],
    queryFn: () => fetchCampaigns({ data: { offset: 0 } }),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });

  const [selectedFieldId, setSelectedFieldId] = useState<string>("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");
  const [attrWindow, setAttrWindow] = useState(30);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showNoOp, setShowNoOp] = useState(false);

  const sentCampaigns = useMemo(
    () => (campaignsQ.data?.campaigns ?? []).filter((c) => c.send_amt > 0 && c.sdate),
    [campaignsQ.data],
  );

  const loadContacts = useCallback(async (offset = 0) => {
    setLoadingContacts(true);
    try {
      const res = await fetchContacts({ data: { offset } });
      if (offset === 0) setContacts(res.contacts);
      else setContacts((prev) => [...prev, ...res.contacts]);
      setTotal(res.total);
      setLoaded(true);
    } finally {
      setLoadingContacts(false);
    }
  }, [fetchContacts]);

  // Load ALL contacts page by page to find everyone with an operation date
  const loadAllContacts = useCallback(async () => {
    setLoadingAll(true);
    try {
      const first = await fetchContacts({ data: { offset: 0 } });
      const totalCount = first.total;
      setTotal(totalCount);

      let all = [...first.contacts];
      const pages = Math.ceil(totalCount / 100);
      const offsets = Array.from({ length: pages - 1 }, (_, i) => (i + 1) * 100);

      await Promise.all(
        offsets.map(async (offset) => {
          const res = await fetchContacts({ data: { offset } });
          all = [...all, ...res.contacts];
        }),
      );

      setContacts(all);
      setLoaded(true);
    } finally {
      setLoadingAll(false);
    }
  }, [fetchContacts]);

  // ─── Attribution analysis ───────────────────────────────────────────────────
  const analysisRows: ContactRow[] = useMemo(() => {
    if (!selectedFieldId || !loaded) return [];

    const campaignsToAnalyze =
      selectedCampaignId === "all"
        ? sentCampaigns
        : sentCampaigns.filter((c) => c.id === selectedCampaignId);

    return contacts
      .map((contact) => {
        const rawValue = contact.fieldValues[selectedFieldId];
        const operationDate = parseDateSafe(rawValue);
        const isDateOnly = rawValue ? isDateOnlyValue(rawValue) : false;

        if (!operationDate) {
          return { contact, rawValue, operationDate: null, isDateOnly: false, closestCampaign: null, minutesDelta: null, daysDelta: null, status: "no_operation" as InfluenceStatus };
        }

        // For date-only fields: compare by calendar day
        // For datetime fields: compare by minutes
        const withinWindow = campaignsToAnalyze.filter((c) => {
          const cd = parseDateSafe(c.sdate);
          if (!cd) return false;
          if (isDateOnly) {
            const daysDiff = differenceInCalendarDays(operationDate, cd);
            // attrWindow is in minutes; convert to days ceiling for date-only
            const dayLimit = Math.ceil(attrWindow / 1440) || 1;
            return daysDiff >= 0 && daysDiff <= dayLimit;
          } else {
            const delta = differenceInMinutes(operationDate, cd);
            return delta >= 0 && delta <= attrWindow;
          }
        });

        if (withinWindow.length === 0) {
          return { contact, rawValue, operationDate, isDateOnly, closestCampaign: null, minutesDelta: null, daysDelta: null, status: "not_influenced" as InfluenceStatus };
        }

        // Most recent campaign before the operation
        const closest = withinWindow.reduce((best, c) => {
          const bestDelta = isDateOnly
            ? differenceInCalendarDays(operationDate, parseDateSafe(best.sdate)!)
            : differenceInMinutes(operationDate, parseDateSafe(best.sdate)!);
          const cDelta = isDateOnly
            ? differenceInCalendarDays(operationDate, parseDateSafe(c.sdate)!)
            : differenceInMinutes(operationDate, parseDateSafe(c.sdate)!);
          return cDelta < bestDelta ? c : best;
        });

        const minutesDelta = isDateOnly ? null : differenceInMinutes(operationDate, parseDateSafe(closest.sdate)!);
        const daysDelta = isDateOnly ? differenceInCalendarDays(operationDate, parseDateSafe(closest.sdate)!) : null;

        return { contact, rawValue, operationDate, isDateOnly, closestCampaign: closest, minutesDelta, daysDelta, status: "influenced" as InfluenceStatus };
      })
      // Sort: influenced first → not_influenced → no_operation
      .sort((a, b) => {
        const order = { influenced: 0, not_influenced: 1, no_operation: 2 };
        return order[a.status] - order[b.status];
      });
  }, [contacts, selectedFieldId, selectedCampaignId, sentCampaigns, attrWindow, loaded]);

  const withOp = analysisRows.filter((r) => r.operationDate !== null);
  const influenced = analysisRows.filter((r) => r.status === "influenced");
  const influenceRate = withOp.length > 0 ? (influenced.length / withOp.length) * 100 : 0;

  const avgMinutes = influenced.filter((r) => !r.isDateOnly && r.minutesDelta !== null).length > 0
    ? influenced.filter((r) => !r.isDateOnly).reduce((s, r) => s + (r.minutesDelta ?? 0), 0) /
      influenced.filter((r) => !r.isDateOnly).length
    : null;

  const displayRows = showNoOp ? analysisRows : analysisRows.filter((r) => r.status !== "no_operation");
  const isDateOnlyMode = withOp.length > 0 && withOp[0].isDateOnly;

  const selectedField = fieldsQ.data?.fields.find((f) => f.id === selectedFieldId);
  const hasMore = contacts.length < total;
  const windowLabel = ATTR_WINDOWS.find((w) => w.value === attrWindow)?.label ?? `${attrWindow}min`;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Análise de Influência</h1>
            <p className="text-sm text-muted-foreground">
              O cliente recebeu a campanha e operou logo em seguida?
            </p>
          </div>
        </div>

        {/* Config card */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold">Configuração da análise</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Campo "Data da Operação" (AC)</label>
              {fieldsQ.isLoading ? (
                <div className="h-9 animate-pulse rounded-lg bg-surface" />
              ) : (
                <select
                  value={selectedFieldId}
                  onChange={(e) => setSelectedFieldId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Selecionar campo…</option>
                  {(fieldsQ.data?.fields ?? []).map((f) => (
                    <option key={f.id} value={f.id}>{f.title} ({f.type})</option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Campo com a data da última operação do contato.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Campanha</label>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="all">Todas as campanhas enviadas</option>
                {sentCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.slice(0, 48)}{c.sdate ? ` (${format(new Date(c.sdate.replace(" ", "T")), "dd/MM/yy HH:mm")})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Janela de atribuição</label>
              <div className="flex gap-1 flex-wrap">
                {ATTR_WINDOWS.map((w) => (
                  <button
                    key={w.value}
                    onClick={() => setAttrWindow(w.value)}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      attrWindow === w.value
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Tempo após o e-mail para considerar influência.
              </p>
            </div>

            <div className="flex flex-col justify-end gap-2">
              <Button
                disabled={!selectedFieldId || loadingContacts || loadingAll}
                onClick={() => loadContacts(0)}
                className="w-full"
                variant="outline"
              >
                <RefreshCw className={cn("mr-1.5 h-4 w-4", loadingContacts && "animate-spin")} />
                Carregar 100
              </Button>
              <Button
                disabled={!selectedFieldId || loadingContacts || loadingAll}
                onClick={loadAllContacts}
                className="w-full"
              >
                {loadingAll
                  ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Carregando todos…</>
                  : <><Zap className="mr-1.5 h-4 w-4" />Carregar todos ({total > 0 ? total : "?"})</>
                }
              </Button>
              {loaded && (
                <p className="text-center text-[11px] text-muted-foreground">
                  {contacts.length} contatos · {withOp.length} com data de operação
                </p>
              )}
            </div>
          </div>

          {/* Date-only warning */}
          {isDateOnlyMode && (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
              <strong>Campo tipo "date" detectado</strong> — armazena apenas a data (sem hora). A comparação será feita por dia, não por minutos.
              Para análise em minutos, use um campo <strong>datetime</strong> no ActiveCampaign.
            </div>
          )}
        </div>

        {/* KPI Cards */}
        {loaded && selectedFieldId && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard icon={<Users className="h-4 w-4 text-primary" />} label="Com data de operação" value={withOp.length.toLocaleString("pt-BR")} sub={`de ${contacts.length} contatos carregados`} />
              <KpiCard icon={<Zap className="h-4 w-4 text-primary" />} label="Influenciados" value={influenced.length.toLocaleString("pt-BR")} sub={`operaram em até ${windowLabel} do e-mail`} good={influenced.length > 0} />
              <KpiCard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Taxa de influência" value={withOp.length > 0 ? `${influenceRate.toFixed(1)}%` : "—"} sub="sobre quem tem op. registrada" good={withOp.length > 0 ? influenceRate >= 10 : undefined} />
              <KpiCard
                icon={<Clock className="h-4 w-4 text-primary" />}
                label="Tempo médio até operar"
                value={avgMinutes !== null ? (avgMinutes < 60 ? `${Math.round(avgMinutes)}min` : `${(avgMinutes / 60).toFixed(1)}h`) : isDateOnlyMode && influenced.length > 0 ? `${(influenced.reduce((s, r) => s + (r.daysDelta ?? 0), 0) / influenced.length).toFixed(1)}d` : "—"}
                sub="após receber o e-mail"
              />
            </div>

            {/* Results table */}
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold">
                    Contatos com "{selectedField?.title ?? selectedFieldId}"
                    {!showNoOp && withOp.length > 0 && (
                      <span className="ml-1 text-muted-foreground font-normal">({withOp.length})</span>
                    )}
                  </h2>
                  <button
                    onClick={() => setShowNoOp((v) => !v)}
                    className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {showNoOp ? "Ocultar sem operação" : `Mostrar todos (${analysisRows.length})`}
                  </button>
                </div>
                {displayRows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportInfluenceCSV(displayRows)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    CSV
                  </Button>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Contato</th>
                      <th className="px-3 py-3 text-left font-medium">E-mail</th>
                      <th className="px-3 py-3 text-left font-medium">Data da operação</th>
                      <th className="px-3 py-3 text-left font-medium">Campanha mais próxima</th>
                      <th className="px-3 py-3 text-right font-medium">Δ tempo</th>
                      <th className="px-3 py-3 text-center font-medium">Status</th>
                      <th className="w-8 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">
                          {loaded
                            ? withOp.length === 0
                              ? "Nenhum contato tem o campo preenchido nos dados carregados. Clique em \"Carregar todos\"."
                              : "Nenhum contato influenciado encontrado."
                            : "Clique em \"Carregar todos\" para iniciar a análise."}
                        </td>
                      </tr>
                    ) : (
                      displayRows.map((row) => <InfluenceRow key={row.contact.id} row={row} />)
                    )}
                  </tbody>
                </table>
              </div>

              {hasMore && !loadingAll && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="text-xs text-muted-foreground">{contacts.length} de {total} contatos</span>
                  <Button variant="outline" size="sm" onClick={() => loadContacts(contacts.length)} disabled={loadingContacts}>
                    <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loadingContacts && "animate-spin")} />
                    {loadingContacts ? "Carregando…" : `+${Math.min(100, total - contacts.length)} contatos`}
                  </Button>
                  <Button size="sm" onClick={loadAllContacts} disabled={loadingAll}>
                    <Zap className="mr-1.5 h-3.5 w-3.5" />
                    Carregar todos
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {!loaded && (
          <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
            <Zap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Selecione o campo e a campanha, depois clique em "Carregar todos".</p>
            <p className="mt-2 text-xs text-muted-foreground">O sistema vai buscar todos os {total > 0 ? total : ""} contatos e verificar quem operou dentro da janela de tempo após receber o e-mail.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function InfluenceRow({ row }: { row: ContactRow }) {
  const { contact, operationDate, closestCampaign, isDateOnly, status } = row;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—";
  const deltaStr = fmtDelta(row);

  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-5 py-3 font-medium">{name}</td>
      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{contact.email || "—"}</td>
      <td className="px-3 py-3 font-mono text-xs">
        {operationDate
          ? format(operationDate, isDateOnly ? "dd/MM/yyyy" : "dd/MM/yyyy HH:mm", { locale: ptBR })
          : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-3 text-xs">
        {closestCampaign ? (
          <div>
            <div className="max-w-[200px] truncate font-medium">{closestCampaign.name}</div>
            {closestCampaign.sdate && (
              <div className="font-mono text-[11px] text-muted-foreground">
                {format(new Date(closestCampaign.sdate.replace(" ", "T")), isDateOnly ? "dd/MM/yyyy" : "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </div>
            )}
          </div>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs">
        {deltaStr !== "—" ? (
          <span className={cn(
            "font-semibold",
            status === "influenced" ? "text-success" : "text-muted-foreground",
          )}>
            {deltaStr}
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-3 text-center"><StatusBadge status={status} /></td>
      <td className="px-3 py-3 text-muted-foreground"><ChevronRight className="h-3.5 w-3.5" /></td>
    </tr>
  );
}

function StatusBadge({ status }: { status: InfluenceStatus }) {
  if (status === "influenced")
    return <span className="inline-flex items-center rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-semibold text-success">Influenciado</span>;
  if (status === "not_influenced")
    return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">Não influenciado</span>;
  return <span className="inline-flex items-center rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">Sem operação</span>;
}

function KpiCard({ icon, label, value, sub, good }: { icon: React.ReactNode; label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={cn("mt-2 font-mono text-3xl font-semibold", good === true ? "text-success" : good === false ? "text-destructive" : "text-foreground")}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
