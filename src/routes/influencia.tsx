import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listContactFields,
  listContactsForAnalysis,
  listCampaigns,
  type ContactSummary,
} from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import { Clock, Download, Loader2, TrendingUp, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInCalendarDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/influencia")({
  ssr: false,
  component: () => (
    <AuthGate>
      <InfluenciaPage />
    </AuthGate>
  ),
});

const FIELD_TITLE = "Data da Última Operação";

const WINDOWS_DAYS = [
  { value: 0, label: "mesmo dia" },
  { value: 1, label: "1 dia" },
  { value: 3, label: "3 dias" },
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
];

type InfluenceStatus = "influenced" | "not_influenced" | "no_operation";

type AnalysisRow = {
  contact: ContactSummary;
  emailReceivedAt: Date;
  operationDate: Date | null;
  daysDelta: number | null;
  status: InfluenceStatus;
};

function parseDateSafe(s: string | undefined | null): Date | null {
  if (!s || s.startsWith("0000") || s.trim() === "") return null;
  const dateOnly = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date | null, withTime = false): string {
  if (!d) return "—";
  return format(d, withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy", { locale: ptBR });
}

function exportCSV(rows: AnalysisRow[], campaignName: string) {
  const header = ["Contato", "E-mail", "Recebeu o e-mail", "Data da Última Operação", "Δ dias", "Status"];
  const data = rows.map((r) => [
    `"${[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ").replace(/"/g, '""') || ""}"`,
    r.contact.email,
    fmtDate(r.emailReceivedAt),
    fmtDate(r.operationDate),
    r.daysDelta !== null ? (r.daysDelta === 0 ? "mesmo dia" : `+${r.daysDelta}d`) : "",
    r.status === "influenced" ? "Influenciado" : r.status === "not_influenced" ? "Fora da janela" : "Sem operação",
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
  const fetchContactFields = useServerFn(listContactFields);
  const fetchContacts = useServerFn(listContactsForAnalysis);
  const fetchCampaigns = useServerFn(listCampaigns);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const hasKey = !!settingsQ.data?.hasApiKey;

  const contactFieldsQ = useQuery({
    queryKey: ["contact-fields"],
    queryFn: () => fetchContactFields(),
    enabled: hasKey,
  });

  const campaignsQ = useQuery({
    queryKey: ["campaigns", 0],
    queryFn: () => fetchCampaigns({ data: { offset: 0 } }),
    enabled: hasKey,
    retry: false,
  });

  // Auto-resolve the fixed field ID
  const operationFieldId = useMemo(() => {
    const fields = contactFieldsQ.data?.fields ?? [];
    return fields.find((f) => f.title === FIELD_TITLE)?.id ?? null;
  }, [contactFieldsQ.data]);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [attrWindowDays, setAttrWindowDays] = useState(0);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const sentCampaigns = useMemo(
    () => (campaignsQ.data?.campaigns ?? []).filter((c) => c.send_amt > 0 && c.sdate),
    [campaignsQ.data],
  );
  const selectedCampaign = sentCampaigns.find((c) => c.id === selectedCampaignId) ?? null;

  const loadAll = useCallback(async () => {
    if (!selectedCampaignId || !operationFieldId) return;
    setLoadingAll(true);
    setContacts([]);
    setLoaded(false);
    try {
      const listId = selectedCampaign?.listId ?? undefined;
      const first = await fetchContacts({ data: { offset: 0, listId } });
      setTotalContacts(first.total);
      const pages = Math.ceil(first.total / 100);
      const offsets = Array.from({ length: pages - 1 }, (_, i) => (i + 1) * 100);
      const rest = await Promise.all(offsets.map((o) => fetchContacts({ data: { offset: o, listId } })));
      setContacts([...first.contacts, ...rest.flatMap((r) => r.contacts)]);
      setLoaded(true);
    } finally {
      setLoadingAll(false);
    }
  }, [fetchContacts, selectedCampaignId, operationFieldId, selectedCampaign]);

  const rows: AnalysisRow[] = useMemo(() => {
    if (!loaded || !selectedCampaign || !operationFieldId) return [];
    const emailReceivedAt = parseDateSafe(selectedCampaign.sdate);
    if (!emailReceivedAt) return [];
    const emailDay = startOfDay(emailReceivedAt);

    return contacts
      .map((contact): AnalysisRow => {
        const rawValue = contact.fieldValues[operationFieldId];
        const operationDate = parseDateSafe(rawValue);

        if (!operationDate) {
          return { contact, emailReceivedAt, operationDate: null, daysDelta: null, status: "no_operation" };
        }

        const opDay = startOfDay(operationDate);
        const daysDelta = differenceInCalendarDays(opDay, emailDay);
        return {
          contact,
          emailReceivedAt,
          operationDate,
          daysDelta,
          status: daysDelta >= 0 && daysDelta <= attrWindowDays ? "influenced" : "not_influenced",
        };
      })
      .filter((r) => r.operationDate !== null)
      .sort((a, b) => {
        const order = { influenced: 0, not_influenced: 1, no_operation: 2 };
        return order[a.status] - order[b.status];
      });
  }, [contacts, selectedCampaign, operationFieldId, attrWindowDays, loaded]);

  const influenced = rows.filter((r) => r.status === "influenced");
  const influenceRate = rows.length > 0 ? (influenced.length / rows.length) * 100 : 0;
  const avgDeltaDays = influenced.length > 0
    ? influenced.reduce((s, r) => s + (r.daysDelta ?? 0), 0) / influenced.length
    : null;

  const currentWindow = attrWindowDays;
  const windowLabel = WINDOWS_DAYS.find((w) => w.value === currentWindow)?.label ?? String(currentWindow);
  const canRun = !!selectedCampaignId && !!operationFieldId;

  const fieldNotFound = contactFieldsQ.isFetched && !operationFieldId;

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
              Quem recebeu o e-mail e operou logo em seguida?
            </p>
          </div>
        </div>

        {fieldNotFound && (
          <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Campo <strong>"{FIELD_TITLE}"</strong> não encontrado nos campos de contato do ActiveCampaign.
          </div>
        )}

        {/* Config */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold">Configuração</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Campanha enviada</label>
              <select
                value={selectedCampaignId}
                onChange={(e) => { setSelectedCampaignId(e.target.value); setLoaded(false); }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Selecionar campanha…</option>
                {sentCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.slice(0, 48)}{c.sdate ? ` — ${format(new Date(c.sdate.replace(" ", "T")), "dd/MM/yy HH:mm")}` : ""}
                  </option>
                ))}
              </select>
              {selectedCampaign?.sdate && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Enviada: <span className="font-mono">{fmtDate(parseDateSafe(selectedCampaign.sdate))}</span>
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Janela após o e-mail</label>
              <div className="flex flex-wrap gap-1">
                {WINDOWS_DAYS.map((w) => (
                  <button
                    key={w.value}
                    onClick={() => setAttrWindowDays(w.value)}
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
                Campo fixo: <span className="font-medium text-foreground">{FIELD_TITLE}</span>
                {operationFieldId && <span className="ml-1 text-success">✓</span>}
                {contactFieldsQ.isLoading && <span className="ml-1 animate-pulse">…</span>}
              </p>
            </div>

            <div className="flex flex-col justify-end">
              <Button disabled={!canRun || loadingAll} onClick={loadAll} className="w-full">
                {loadingAll
                  ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Carregando…</>
                  : <><Zap className="mr-1.5 h-4 w-4" />Rodar análise</>}
              </Button>
              {loaded && (
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  {totalContacts.toLocaleString("pt-BR")} contatos · {rows.length} com operação registrada
                </p>
              )}
            </div>
          </div>
        </div>

        {/* KPIs */}
        {loaded && selectedCampaign && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard icon={<Users className="h-4 w-4 text-primary" />} label="Contatos com operação" value={rows.length.toLocaleString("pt-BR")} sub={`de ${totalContacts.toLocaleString("pt-BR")} contatos carregados`} />
              <KpiCard icon={<Zap className="h-4 w-4 text-primary" />} label={`Operaram em até ${windowLabel}`} value={influenced.length.toLocaleString("pt-BR")} sub="após o e-mail" good={influenced.length > 0} />
              <KpiCard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Taxa de influência" value={rows.length > 0 ? `${influenceRate.toFixed(1)}%` : "—"} sub="dos contatos com operação" good={rows.length > 0 ? influenceRate >= 5 : undefined} />
              <KpiCard
                icon={<Clock className="h-4 w-4 text-primary" />}
                label="Tempo médio"
                value={avgDeltaDays !== null ? (avgDeltaDays === 0 ? "mesmo dia" : `${avgDeltaDays.toFixed(1)} dias`) : "—"}
                sub="até operar após o e-mail"
              />
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Contatos com operação registrada</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Campanha: <span className="font-medium text-foreground">{selectedCampaign.name}</span>
                    {" · "}Enviada: <span className="font-mono">{fmtDate(parseDateSafe(selectedCampaign.sdate))}</span>
                  </p>
                </div>
                {rows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportCSV(rows, selectedCampaign.name)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />CSV
                  </Button>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Contato</th>
                      <th className="px-3 py-3 text-left font-medium text-blue-400">📨 Recebeu o e-mail</th>
                      <th className="px-3 py-3 text-left font-medium text-green-400">💼 Última Operação</th>
                      <th className="px-3 py-3 text-right font-medium">Δ dias</th>
                      <th className="px-3 py-3 text-center font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">
                          Nenhum contato com operação registrada encontrado.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => <RowItem key={row.contact.id} row={row} />)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!loaded && (
          <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
            <Zap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">
              {!selectedCampaignId ? "Selecione a campanha enviada." : "Clique em \"Rodar análise\"."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Cruza o envio com o campo <strong>{FIELD_TITLE}</strong> — apenas contatos da lista da campanha.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function RowItem({ row }: { row: AnalysisRow }) {
  const { contact, emailReceivedAt, operationDate, daysDelta, status } = row;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—";
  const isWithinWindow = status === "influenced";

  let deltaStr = "—";
  let deltaNeg = false;
  if (daysDelta !== null) {
    deltaNeg = daysDelta < 0;
    deltaStr = daysDelta === 0 ? "mesmo dia" : `${daysDelta < 0 ? "−" : "+"}${Math.abs(daysDelta)}d`;
  }

  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-5 py-3">
        <div className="font-medium">{name}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{contact.email}</div>
      </td>
      <td className="px-3 py-3 font-mono text-xs">{fmtDate(emailReceivedAt)}</td>
      <td className="px-3 py-3 font-mono text-xs">
        {operationDate ? (
          <span className={cn(isWithinWindow ? "text-success font-semibold" : "")}>
            {fmtDate(operationDate)}
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs">
        <span className={cn("font-semibold", deltaNeg ? "text-muted-foreground" : isWithinWindow ? "text-success" : "text-muted-foreground")}>
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
      <div className={cn("mt-2 font-mono text-3xl font-semibold", good === true ? "text-success" : good === false ? "text-destructive" : "text-foreground")}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
