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
import { Clock, Download, Loader2, TrendingUp, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInMinutes, differenceInCalendarDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/influencia")({
  ssr: false,
  component: () => (
    <AuthGate>
      <InfluenciaPage />
    </AuthGate>
  ),
});

// Windows for datetime fields (in minutes)
const WINDOWS_MINUTES = [
  { value: 30, label: "30min" },
  { value: 60, label: "1h" },
  { value: 120, label: "2h" },
  { value: 240, label: "4h" },
  { value: 1440, label: "1 dia" },
];

// Windows for date-only fields (in days)
const WINDOWS_DAYS = [
  { value: 0, label: "mesmo dia" },
  { value: 1, label: "1 dia" },
  { value: 3, label: "3 dias" },
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
];

type InfluenceStatus = "influenced" | "not_influenced" | "no_operation";

type ContactRow = {
  contact: ContactSummary;
  emailReceivedAt: Date;
  operationDate: Date | null;
  rawOperationValue: string | undefined;
  minutesDelta: number | null; // null when field is date-only
  daysDelta: number | null;    // null when field is datetime
  fieldIsDateOnly: boolean;
  status: InfluenceStatus;
};

function parseDateSafe(s: string | undefined | null): Date | null {
  if (!s || s.startsWith("0000") || s.trim() === "") return null;
  // ISO date-only "YYYY-MM-DD" — parse as LOCAL midnight to avoid UTC offset
  const dateOnly = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
  }
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

// Whether a raw AC field value has no meaningful time (date-only field)
function isDateOnly(s: string | undefined): boolean {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ||
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(s.trim()) &&
    s.trim().endsWith("00:00:00");
}

function fmtDate(d: Date | null, withTime = true): string {
  if (!d) return "—";
  return format(d, withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy", { locale: ptBR });
}

function fmtDelta(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function exportCSV(rows: ContactRow[], campaignName: string) {
  const header = ["Nome", "E-mail", "Recebeu o e-mail (campanha)", "Data da Última Operação", "Δ (minutos)", "Status"];
  const data = rows.map((r) => [
    `"${[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ").replace(/"/g, '""') || ""}"`,
    r.contact.email,
    fmtDate(r.emailReceivedAt),
    fmtDate(r.operationDate),
    r.minutesDelta ?? "",
    r.status === "influenced" ? "Influenciado" : r.status === "not_influenced" ? "Não operou dentro da janela" : "Sem data de operação",
  ]);
  const csv = [header, ...data].map((r) => r.join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `influencia_${campaignName.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}_${format(new Date(), "yyyy-MM-dd")}.csv`;
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
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [attrWindowMinutes, setAttrWindowMinutes] = useState(30);
  const [attrWindowDays, setAttrWindowDays] = useState(0);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const sentCampaigns = useMemo(
    () => (campaignsQ.data?.campaigns ?? []).filter((c) => c.send_amt > 0 && c.sdate),
    [campaignsQ.data],
  );

  const selectedCampaign = sentCampaigns.find((c) => c.id === selectedCampaignId) ?? null;

  // Load ALL contacts at once (paginated in parallel)
  const loadAllContacts = useCallback(async () => {
    if (!selectedFieldId || !selectedCampaignId) return;
    setLoadingAll(true);
    setContacts([]);
    setLoaded(false);
    try {
      const first = await fetchContacts({ data: { offset: 0 } });
      const totalCount = first.total;
      setTotal(totalCount);

      const pages = Math.ceil(totalCount / 100);
      const offsets = Array.from({ length: pages - 1 }, (_, i) => (i + 1) * 100);

      // Collect each page result independently — no race condition
      const pageResults = await Promise.all(
        offsets.map((offset) => fetchContacts({ data: { offset } })),
      );

      const all = [
        ...first.contacts,
        ...pageResults.flatMap((r) => r.contacts),
      ];

      setContacts(all);
      setLoaded(true);
    } finally {
      setLoadingAll(false);
    }
  }, [fetchContacts, selectedFieldId, selectedCampaignId]);

  // ─── Main analysis ──────────────────────────────────────────────────────────
  const rows: ContactRow[] = useMemo(() => {
    if (!loaded || !selectedCampaign || !selectedFieldId) return [];

    const emailReceivedAt = parseDateSafe(selectedCampaign.sdate);
    if (!emailReceivedAt) return [];

    // Detect field mode from first contact that has a value
    const sampleValue = contacts.find((c) => c.fieldValues[selectedFieldId])?.fieldValues[selectedFieldId];
    const fieldIsDateOnly = isDateOnly(sampleValue);

    const emailDay = startOfDay(emailReceivedAt);

    return contacts
      .map((contact): ContactRow => {
        const rawValue = contact.fieldValues[selectedFieldId];
        const operationDate = parseDateSafe(rawValue);

        const base: Omit<ContactRow, "minutesDelta" | "daysDelta" | "status"> = {
          contact, emailReceivedAt, operationDate, rawOperationValue: rawValue, fieldIsDateOnly,
        };

        if (!operationDate) {
          return { ...base, minutesDelta: null, daysDelta: null, status: "no_operation" };
        }

        if (fieldIsDateOnly) {
          // Compare calendar days only — no time involved
          const opDay = startOfDay(operationDate);
          const daysDelta = differenceInCalendarDays(opDay, emailDay);
          const influenced = daysDelta >= 0 && daysDelta <= attrWindowDays;
          return { ...base, minutesDelta: null, daysDelta, status: influenced ? "influenced" : "not_influenced" };
        } else {
          // Compare exact minutes
          const minutesDelta = differenceInMinutes(operationDate, emailReceivedAt);
          const influenced = minutesDelta >= 0 && minutesDelta <= attrWindowMinutes;
          return { ...base, minutesDelta, daysDelta: null, status: influenced ? "influenced" : "not_influenced" };
        }
      })
      .filter((r) => r.operationDate !== null)
      .sort((a, b) => {
        const order = { influenced: 0, not_influenced: 1, no_operation: 2 };
        return order[a.status] - order[b.status];
      });
  }, [contacts, selectedCampaign, selectedFieldId, attrWindowMinutes, attrWindowDays, loaded]);

  const fieldIsDateOnly = rows[0]?.fieldIsDateOnly ?? false;

  const influenced = rows.filter((r) => r.status === "influenced");
  const notInfluenced = rows.filter((r) => r.status === "not_influenced");
  const influenceRate = rows.length > 0 ? (influenced.length / rows.length) * 100 : 0;

  const avgDeltaMinutes = !fieldIsDateOnly && influenced.length > 0
    ? influenced.reduce((s, r) => s + (r.minutesDelta ?? 0), 0) / influenced.length
    : null;
  const avgDeltaDays = fieldIsDateOnly && influenced.length > 0
    ? influenced.reduce((s, r) => s + (r.daysDelta ?? 0), 0) / influenced.length
    : null;

  const windows = fieldIsDateOnly ? WINDOWS_DAYS : WINDOWS_MINUTES;
  const currentWindow = fieldIsDateOnly ? attrWindowDays : attrWindowMinutes;
  const windowLabel = windows.find((w) => w.value === currentWindow)?.label ?? String(currentWindow);
  const canRun = !!selectedFieldId && !!selectedCampaignId;

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
              O cliente recebeu o e-mail e operou nos minutos seguintes?
            </p>
          </div>
        </div>

        {/* Config */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold">Configuração</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

            {/* Campanha */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Campanha enviada
              </label>
              <select
                value={selectedCampaignId}
                onChange={(e) => { setSelectedCampaignId(e.target.value); setLoaded(false); }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Selecionar campanha…</option>
                {sentCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.slice(0, 50)}
                    {c.sdate ? ` — ${format(new Date(c.sdate.replace(" ", "T")), "dd/MM/yy HH:mm")}` : ""}
                  </option>
                ))}
              </select>
              {selectedCampaign?.sdate && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Enviada em: <span className="font-mono">{fmtDate(parseDateSafe(selectedCampaign.sdate))}</span>
                </p>
              )}
            </div>

            {/* Campo de operação */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Campo "Data da Última Operação"
              </label>
              {fieldsQ.isLoading ? (
                <div className="h-9 animate-pulse rounded-lg bg-surface" />
              ) : (
                <select
                  value={selectedFieldId}
                  onChange={(e) => { setSelectedFieldId(e.target.value); setLoaded(false); }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Selecionar campo…</option>
                  {(fieldsQ.data?.fields ?? []).map((f) => (
                    <option key={f.id} value={f.id}>{f.title} ({f.type})</option>
                  ))}
                </select>
              )}
            </div>

            {/* Janela */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Janela após o e-mail
                {loaded && fieldIsDateOnly && (
                  <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">campo date — sem hora</span>
                )}
              </label>
              <div className="flex flex-wrap gap-1">
                {(loaded && fieldIsDateOnly ? WINDOWS_DAYS : WINDOWS_MINUTES).map((w) => (
                  <button
                    key={w.value}
                    onClick={() => fieldIsDateOnly ? setAttrWindowDays(w.value) : setAttrWindowMinutes(w.value)}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      currentWindow === w.value
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {loaded && fieldIsDateOnly
                  ? "Campo armazena só data — comparação por dia de calendário."
                  : "Tempo máximo entre receber o e-mail e operar."}
              </p>
            </div>

            {/* Rodar */}
            <div className="flex flex-col justify-end">
              <Button
                disabled={!canRun || loadingAll}
                onClick={loadAllContacts}
                className="w-full"
              >
                {loadingAll
                  ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Carregando…</>
                  : <><Zap className="mr-1.5 h-4 w-4" />Rodar análise</>}
              </Button>
              {loaded && (
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  {total.toLocaleString("pt-BR")} contatos analisados · {rows.length} com operação registrada
                </p>
              )}
            </div>
          </div>
        </div>

        {/* KPIs */}
        {loaded && selectedCampaign && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                icon={<Users className="h-4 w-4 text-primary" />}
                label="Com data de operação"
                value={rows.length.toLocaleString("pt-BR")}
                sub={`de ${total.toLocaleString("pt-BR")} contatos na base`}
              />
              <KpiCard
                icon={<Zap className="h-4 w-4 text-primary" />}
                label={`Operaram em até ${windowLabel}`}
                value={influenced.length.toLocaleString("pt-BR")}
                sub="após receber o e-mail"
                good={influenced.length > 0}
              />
              <KpiCard
                icon={<TrendingUp className="h-4 w-4 text-primary" />}
                label="Taxa de influência"
                value={rows.length > 0 ? `${influenceRate.toFixed(1)}%` : "—"}
                sub="dos que têm operação registrada"
                good={rows.length > 0 ? influenceRate >= 5 : undefined}
              />
              <KpiCard
                icon={<Clock className="h-4 w-4 text-primary" />}
                label="Tempo médio até operar"
                value={
                  avgDeltaMinutes !== null ? fmtDelta(Math.round(avgDeltaMinutes)) :
                  avgDeltaDays !== null ? (avgDeltaDays === 0 ? "mesmo dia" : `${avgDeltaDays.toFixed(1)} dias`) :
                  "—"
                }
                sub="após receber o e-mail"
              />
            </div>

            {/* Table */}
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">
                    Contatos com operação registrada
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Campanha: <span className="font-medium text-foreground">{selectedCampaign.name}</span>
                    {" · "}Enviada: <span className="font-mono">{fmtDate(parseDateSafe(selectedCampaign.sdate))}</span>
                  </p>
                </div>
                {rows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportCSV(rows, selectedCampaign.name)}>
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
                      <th className="px-3 py-3 text-left font-medium text-primary/80">📨 Recebeu o e-mail</th>
                      <th className="px-3 py-3 text-left font-medium text-primary/80">💼 Data da Operação</th>
                      <th className="px-3 py-3 text-right font-medium">Δ tempo</th>
                      <th className="px-3 py-3 text-center font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
                          Nenhum contato com data de operação encontrado.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => <InfluenceRow key={row.contact.id} row={row} />)
                    )}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span><span className="inline-block h-2 w-2 rounded-full bg-success mr-1" />{influenced.length} influenciados (operaram em até {windowLabel})</span>
                <span><span className="inline-block h-2 w-2 rounded-full bg-muted mr-1" />{notInfluenced.length} não operaram dentro da janela</span>
              </div>
            </div>
          </>
        )}

        {!loaded && (
          <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
            <Zap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">
              {!selectedCampaignId
                ? "Selecione a campanha que foi enviada."
                : !selectedFieldId
                ? "Selecione o campo 'Data da Última Operação'."
                : "Clique em \"Rodar análise\" para cruzar os dados."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              A análise compara <strong>quando o e-mail foi enviado</strong> com <strong>quando o contato operou</strong> e mostra quem operou dentro da janela de tempo.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function InfluenceRow({ row }: { row: ContactRow }) {
  const { contact, emailReceivedAt, operationDate, minutesDelta, daysDelta, fieldIsDateOnly, status } = row;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—";
  const isWithinWindow = status === "influenced";

  // Format delta string
  let deltaStr = "—";
  let deltaNegative = false;
  if (fieldIsDateOnly && daysDelta !== null) {
    deltaNegative = daysDelta < 0;
    deltaStr = daysDelta === 0 ? "mesmo dia" : `${daysDelta < 0 ? "−" : "+"}${Math.abs(daysDelta)}d`;
  } else if (!fieldIsDateOnly && minutesDelta !== null) {
    deltaNegative = minutesDelta < 0;
    deltaStr = `${minutesDelta < 0 ? "−" : "+"}${fmtDelta(Math.abs(minutesDelta))}`;
  }

  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-5 py-3 font-medium">{name}</td>
      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{contact.email || "—"}</td>

      {/* Recebeu o e-mail — always show with time */}
      <td className="px-3 py-3 font-mono text-xs">
        {fmtDate(emailReceivedAt, true)}
      </td>

      {/* Data da Operação — date-only field: show without fake time */}
      <td className="px-3 py-3 font-mono text-xs">
        {operationDate ? (
          <span className={cn(isWithinWindow ? "text-success font-semibold" : "text-foreground")}>
            {fmtDate(operationDate, !fieldIsDateOnly)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Delta */}
      <td className="px-3 py-3 text-right font-mono text-xs">
        <span className={cn("font-semibold", deltaNegative ? "text-muted-foreground" : isWithinWindow ? "text-success" : "text-muted-foreground")}>
          {deltaStr}
        </span>
      </td>

      <td className="px-3 py-3 text-center"><StatusBadge status={status} /></td>
    </tr>
  );
}

function StatusBadge({ status }: { status: InfluenceStatus }) {
  if (status === "influenced")
    return <span className="inline-flex items-center rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-semibold text-success">✓ Influenciado</span>;
  if (status === "not_influenced")
    return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">Fora da janela</span>;
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
