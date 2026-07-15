import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listContactFields,
  listCampaigns,
  getCampaignOpens,
  getContactsByIds,
  type ContactSummary,
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

const FIELD_TITLE = "Data da Última Operação";
const INFLUENCE_WINDOW_HOURS = 24;

type InfluenceStatus = "influenced" | "not_influenced" | "no_operation";

type AnalysisRow = {
  contact: ContactSummary;
  emailReceivedAt: Date;
  operationDate: Date | null;
  deltaMinutes: number | null;
  status: InfluenceStatus;
};

function fmtDelta(minutes: number | null): string {
  if (minutes === null) return "—";
  const neg = minutes < 0;
  const abs = Math.abs(minutes);
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = Math.round(abs % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && hours === 0) parts.push(`${mins}min`);
  return `${neg ? "−" : "+"}${parts.join(" ")}`;
}

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
  const header = ["Contato", "E-mail", "Abriu o e-mail", "Data da Última Operação", "Δ tempo", "Status"];
  const data = rows.map((r) => [
    `"${[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ").replace(/"/g, '""') || ""}"`,
    r.contact.email,
    fmtDate(r.emailReceivedAt, true),
    fmtDate(r.operationDate, true),
    fmtDelta(r.deltaMinutes),
    r.status === "influenced" ? "Influenciado" : r.status === "not_influenced" ? "Não influenciado" : "Sem operação",
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
  const fetchCampaigns = useServerFn(listCampaigns);
  const fetchCampaignOpens = useServerFn(getCampaignOpens);
  const fetchContactsByIds = useServerFn(getContactsByIds);

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

  const [resultsTab, setResultsTab] = useState<"operaram" | "nao_operaram">("operaram");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [openedAtMap, setOpenedAtMap] = useState<Record<string, string>>({});
  const [totalContacts, setTotalContacts] = useState(0);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const sentCampaigns = useMemo(
    () => (campaignsQ.data?.campaigns ?? []).filter((c) => c.send_amt > 0 && c.sdate),
    [campaignsQ.data],
  );
  const selectedCampaign = sentCampaigns.find((c) => c.id === selectedCampaignId) ?? null;

  const noOpensFound = loaded && contacts.length === 0;

  const loadAll = useCallback(async () => {
    if (!selectedCampaignId || !operationFieldId) return;
    setLoadingAll(true);
    setContacts([]);
    setOpenedAtMap({});
    setLoaded(false);
    try {
      // ActiveCampaign's public API has no "who received this campaign" endpoint —
      // the open-tracking pixel is the only real per-contact, per-campaign proof of receipt.
      const { openedAt } = await fetchCampaignOpens({ data: { id: selectedCampaignId } });
      const contactIds = Object.keys(openedAt);

      const BATCH = 25;
      const loadedContacts: ContactSummary[] = [];
      for (let i = 0; i < contactIds.length; i += BATCH) {
        const batchIds = contactIds.slice(i, i + BATCH);
        const { contacts: batch } = await fetchContactsByIds({ data: { ids: batchIds } });
        loadedContacts.push(...batch);
      }

      setOpenedAtMap(openedAt);
      setTotalContacts(loadedContacts.length);
      setContacts(loadedContacts);
      setLoaded(true);
    } finally {
      setLoadingAll(false);
    }
  }, [selectedCampaignId, operationFieldId, fetchCampaignOpens, fetchContactsByIds]);

  const rows: AnalysisRow[] = useMemo(() => {
    if (!loaded || !operationFieldId) return [];

    return contacts
      .map((contact): AnalysisRow | null => {
        const emailReceivedAt = parseDateSafe(openedAtMap[contact.id]);
        if (!emailReceivedAt) return null;

        const rawValue = contact.fieldValues[operationFieldId];
        const operationDate = parseDateSafe(rawValue);

        if (!operationDate) {
          return { contact, emailReceivedAt, operationDate: null, deltaMinutes: null, status: "no_operation" };
        }

        const deltaMinutes = differenceInMinutes(operationDate, emailReceivedAt);
        const withinWindow = deltaMinutes > 0 && deltaMinutes <= INFLUENCE_WINDOW_HOURS * 60;
        return {
          contact,
          emailReceivedAt,
          operationDate,
          deltaMinutes,
          status: withinWindow ? "influenced" : "not_influenced",
        };
      })
      .filter((r): r is AnalysisRow => r !== null)
      .sort((a, b) => {
        const order = { influenced: 0, not_influenced: 1, no_operation: 2 };
        return order[a.status] - order[b.status];
      });
  }, [contacts, openedAtMap, operationFieldId, loaded]);

  const influenced = rows.filter((r) => r.status === "influenced");
  const notOperated = rows.filter((r) => r.status === "no_operation" || r.status === "not_influenced");
  const totalOpened = rows.length;
  const influenceRate = totalOpened > 0 ? (influenced.length / totalOpened) * 100 : 0;
  const avgDeltaMinutes = influenced.length > 0
    ? influenced.reduce((s, r) => s + (r.deltaMinutes ?? 0), 0) / influenced.length
    : null;

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
              Quem abriu o e-mail e operou logo em seguida?
            </p>
          </div>
        </div>

        {fieldNotFound && (
          <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Campo <strong>"{FIELD_TITLE}"</strong> não encontrado nos campos de contato do ActiveCampaign.
          </div>
        )}

        {noOpensFound && (
          <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Nenhuma abertura registrada para este e-mail ainda — não há como confirmar quem recebeu.
          </div>
        )}

        {/* Config */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold">Configuração</h2>
          <div className="grid gap-4 sm:grid-cols-2">

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">E-mail enviado</label>
              <select
                value={selectedCampaignId}
                onChange={(e) => { setSelectedCampaignId(e.target.value); setLoaded(false); }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Selecionar e-mail…</option>
                {sentCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.slice(0, 48)}{c.sdate ? ` — ${format(new Date(c.sdate.replace(" ", "T")), "dd/MM/yy HH:mm")}` : ""}
                  </option>
                ))}
              </select>
              {selectedCampaign?.sdate && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Enviada: <span className="font-mono">{fmtDate(parseDateSafe(selectedCampaign.sdate), true)}</span>
                </p>
              )}
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
                  {totalContacts.toLocaleString("pt-BR")} abriram · {influenced.length} operaram em até {INFLUENCE_WINDOW_HOURS}h
                </p>
              )}
            </div>
          </div>
        </div>

        {/* KPIs */}
        {loaded && selectedCampaign && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard icon={<Users className="h-4 w-4 text-primary" />} label="Abriram o e-mail" value={totalContacts.toLocaleString("pt-BR")} sub="contatos únicos" />
              <KpiCard icon={<Zap className="h-4 w-4 text-primary" />} label="Operaram em até 48h" value={influenced.length.toLocaleString("pt-BR")} sub={`de ${totalContacts.toLocaleString("pt-BR")} que abriram`} good={influenced.length > 0} />
              <KpiCard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Taxa de influência" value={totalContacts > 0 ? `${influenceRate.toFixed(1)}%` : "—"} sub="abriram e operaram em 48h" good={totalContacts > 0 ? influenceRate >= 5 : undefined} />
              <KpiCard
                icon={<Clock className="h-4 w-4 text-primary" />}
                label="Tempo médio"
                value={fmtDelta(avgDeltaMinutes !== null ? Math.round(avgDeltaMinutes) : null)}
                sub="até operar após o e-mail"
              />
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  E-mail: <span className="font-medium text-foreground">{selectedCampaign.name}</span>
                  {" · "}Enviada: <span className="font-mono">{fmtDate(parseDateSafe(selectedCampaign.sdate), true)}</span>
                </p>
                {rows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportCSV(resultsTab === "operaram" ? influenced : notOperated, selectedCampaign.name)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />CSV
                  </Button>
                )}
              </div>

              {/* Abas */}
              <div className="mb-4 flex gap-2">
                <button
                  onClick={() => setResultsTab("operaram")}
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    resultsTab === "operaram"
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  ✓ Operaram <span className="ml-1 font-mono text-xs">({influenced.length})</span>
                </button>
                <button
                  onClick={() => setResultsTab("nao_operaram")}
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    resultsTab === "nao_operaram"
                      ? "bg-muted text-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  Não operaram <span className="ml-1 font-mono text-xs">({notOperated.length})</span>
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Contato</th>
                      <th className="px-3 py-3 text-left font-medium text-blue-400">📨 Abriu o e-mail</th>
                      {resultsTab === "operaram" && <>
                        <th className="px-3 py-3 text-left font-medium text-green-400">💼 Última Operação</th>
                        <th className="px-3 py-3 text-right font-medium">Δ tempo</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {resultsTab === "operaram" ? (
                      influenced.length === 0 ? (
                        <tr><td colSpan={4} className="px-5 py-12 text-center text-muted-foreground">Nenhum contato operou dentro de {INFLUENCE_WINDOW_HOURS}h após abrir o e-mail.</td></tr>
                      ) : (
                        influenced.map((row) => <RowItem key={row.contact.id} row={row} showOperation />)
                      )
                    ) : (
                      notOperated.length === 0 ? (
                        <tr><td colSpan={2} className="px-5 py-12 text-center text-muted-foreground">Todos os contatos operaram!</td></tr>
                      ) : (
                        notOperated.map((row) => <RowItem key={row.contact.id} row={row} showOperation={false} />)
                      )
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
              {!selectedCampaignId ? "Selecione o e-mail enviado." : "Clique em \"Rodar análise\"."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Cruza quem abriu este e-mail (única prova de recebimento que a API do ActiveCampaign expõe) com o campo <strong>{FIELD_TITLE}</strong>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function RowItem({ row, showOperation }: { row: AnalysisRow; showOperation: boolean }) {
  const { contact, emailReceivedAt, operationDate, deltaMinutes } = row;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—";

  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-5 py-3">
        <div className="font-medium">{name}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{contact.email}</div>
      </td>
      <td className="px-3 py-3 font-mono text-xs">{fmtDate(emailReceivedAt, true)}</td>
      {showOperation && <>
        <td className="px-3 py-3 font-mono text-xs">
          <span className="text-success font-semibold">{fmtDate(operationDate, true)}</span>
        </td>
        <td className="px-3 py-3 text-right font-mono text-xs">
          <span className="font-semibold text-success">{fmtDelta(deltaMinutes)}</span>
        </td>
      </>}
    </tr>
  );
}

function StatusBadge({ status }: { status: InfluenceStatus }) {
  if (status === "influenced")
    return <span className="inline-flex items-center rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-semibold text-success">✓ Influenciado</span>;
  if (status === "not_influenced")
    return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">Não influenciado</span>;
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
