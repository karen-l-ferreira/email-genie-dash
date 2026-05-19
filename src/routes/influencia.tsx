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
import { format, differenceInMinutes } from "date-fns";
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
  emailReceivedAt: Date;    // campaign sdate = when the email was sent/received
  operationDate: Date | null; // value from the AC custom field
  minutesDelta: number | null;
  status: InfluenceStatus;
};

function parseDateSafe(s: string | undefined | null): Date | null {
  if (!s || s.startsWith("0000") || s.trim() === "") return null;
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
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
  const [attrWindow, setAttrWindow] = useState(30);
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
  }, [fetchContacts, selectedFieldId, selectedCampaignId]);

  // ─── Main analysis ──────────────────────────────────────────────────────────
  // For each contact:
  //   emailReceivedAt = selected campaign sdate (when the email was sent)
  //   operationDate   = contact's custom field value (last operation date)
  //   delta           = operationDate - emailReceivedAt (in minutes)
  //   influenced      = delta >= 0 AND delta <= attrWindow

  const rows: ContactRow[] = useMemo(() => {
    if (!loaded || !selectedCampaign || !selectedFieldId) return [];

    const emailReceivedAt = parseDateSafe(selectedCampaign.sdate);
    if (!emailReceivedAt) return [];

    return contacts
      .map((contact): ContactRow => {
        const rawValue = contact.fieldValues[selectedFieldId];
        const operationDate = parseDateSafe(rawValue);

        if (!operationDate) {
          return { contact, emailReceivedAt, operationDate: null, minutesDelta: null, status: "no_operation" };
        }

        const delta = differenceInMinutes(operationDate, emailReceivedAt);

        if (delta >= 0 && delta <= attrWindow) {
          return { contact, emailReceivedAt, operationDate, minutesDelta: delta, status: "influenced" };
        }

        return { contact, emailReceivedAt, operationDate, minutesDelta: delta, status: "not_influenced" };
      })
      .filter((r) => r.operationDate !== null) // only show contacts that have the field filled
      .sort((a, b) => {
        const order = { influenced: 0, not_influenced: 1, no_operation: 2 };
        return order[a.status] - order[b.status];
      });
  }, [contacts, selectedCampaign, selectedFieldId, attrWindow, loaded]);

  const influenced = rows.filter((r) => r.status === "influenced");
  const notInfluenced = rows.filter((r) => r.status === "not_influenced");
  const influenceRate = rows.length > 0 ? (influenced.length / rows.length) * 100 : 0;
  const avgDelta = influenced.length > 0
    ? influenced.reduce((s, r) => s + (r.minutesDelta ?? 0), 0) / influenced.length
    : null;

  const windowLabel = ATTR_WINDOWS.find((w) => w.value === attrWindow)?.label ?? `${attrWindow}min`;
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
              </label>
              <div className="flex flex-wrap gap-1">
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
                Tempo máximo entre receber o e-mail e operar.
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
                value={avgDelta !== null ? fmtDelta(Math.round(avgDelta)) : "—"}
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
                      rows.map((row) => <InfluenceRow key={row.contact.id} row={row} attrWindow={attrWindow} />)
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

function InfluenceRow({ row, attrWindow }: { row: ContactRow; attrWindow: number }) {
  const { contact, emailReceivedAt, operationDate, minutesDelta, status } = row;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—";

  // Determine if operation happened BEFORE the email (negative delta)
  const isBeforeEmail = minutesDelta !== null && minutesDelta < 0;
  const isWithinWindow = status === "influenced";

  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-5 py-3">
        <div className="font-medium">{name}</div>
      </td>
      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{contact.email || "—"}</td>

      {/* Recebeu o e-mail */}
      <td className="px-3 py-3 font-mono text-xs">
        <span className="text-foreground">{fmtDate(emailReceivedAt)}</span>
      </td>

      {/* Data da Operação */}
      <td className="px-3 py-3 font-mono text-xs">
        {operationDate ? (
          <span className={cn(isWithinWindow ? "text-success font-semibold" : "text-foreground")}>
            {fmtDate(operationDate)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Delta */}
      <td className="px-3 py-3 text-right font-mono text-xs">
        {minutesDelta !== null ? (
          <span className={cn(
            "font-semibold",
            isBeforeEmail ? "text-muted-foreground" :
            isWithinWindow ? "text-success" : "text-muted-foreground",
          )}>
            {isBeforeEmail ? `−${fmtDelta(Math.abs(minutesDelta))}` : `+${fmtDelta(minutesDelta)}`}
          </span>
        ) : "—"}
      </td>

      <td className="px-3 py-3 text-center">
        <StatusBadge status={status} />
      </td>
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
