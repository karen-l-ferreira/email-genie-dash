import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, MoonStar, Play, Save, Snowflake, Users } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getListSize,
  getOpenHistory,
  listAccountContactLinks,
  listLists,
  listSnapshots,
  saveSnapshot,
  type Campaign,
} from "@/lib/ac.functions";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, Panel, selectClass, Stat, Tag } from "@/components/app/ui-kit";
import { cn } from "@/lib/utils";
import { buildSeries } from "@/lib/analysis/series";
import { buildCompanyEngagement, dormancyRows, type CompanyRow, type DormancyRow } from "@/lib/analysis/audience";

const WINDOWS = [3, 5, 8];

type Result = {
  seriesLabel: string;
  listId: string;
  listName: string;
  listSize: number;
  n: number;
  dormancy: DormancyRow[];
  companies: CompanyRow[];
  contactsWithOpens: number;
  failed: number;
  truncatedLinks: boolean;
};

export function AudienceTab({ campaigns }: { campaigns: Campaign[] }) {
  const fetchLists = useServerFn(listLists);
  const fetchSize = useServerFn(getListSize);
  const fetchHistory = useServerFn(getOpenHistory);
  const fetchLinks = useServerFn(listAccountContactLinks);
  const fetchSave = useServerFn(saveSnapshot);
  const fetchSnaps = useServerFn(listSnapshots);

  // Only series with enough sends make a meaningful window
  const series = useMemo(() => buildSeries(campaigns, 3), [campaigns]);
  const listsQ = useQuery({ queryKey: ["ac-lists"], queryFn: () => fetchLists(), staleTime: 30 * 60 * 1000 });

  const [seriesKey, setSeriesKey] = useState("");
  const [listOverride, setListOverride] = useState("");
  const [n, setN] = useState(5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = series.find((s) => s.key === seriesKey) ?? null;
  const detectedListId = selected?.sends[0].listId ?? "";
  const listId = listOverride || detectedListId;

  const snapEntity = result ? `base-muda:${result.listId}` : "";
  const snapsQ = useQuery({
    queryKey: ["base-muda-history", snapEntity],
    queryFn: () => fetchSnaps({ data: { entity_id: snapEntity } }),
    enabled: !!snapEntity,
  });

  async function run() {
    if (!selected || !listId) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const sends = selected.sends.slice(0, n);
      const ids = sends.map((s) => s.id);
      const [{ size }, history, links] = await Promise.all([
        fetchSize({ data: { listId } }),
        fetchHistory({ data: { ids } }),
        fetchLinks(),
      ]);
      setResult({
        seriesLabel: selected.label,
        listId,
        listName: listsQ.data?.lists.find((l) => l.id === listId)?.name ?? `Lista ${listId}`,
        listSize: size,
        n: ids.length,
        dormancy: dormancyRows(size, history.opened, ids.length),
        companies: buildCompanyEngagement(history.opened, links.links, links.names),
        contactsWithOpens: Object.keys(history.opened).length,
        failed: history.failed,
        truncatedLinks: links.truncated,
      });
    } catch (e: any) {
      setError(e?.message ?? "Não consegui concluir a análise.");
    } finally {
      setRunning(false);
    }
  }

  async function saveBaseSnapshot() {
    if (!result) return;
    const last = result.dormancy[result.dormancy.length - 1];
    setSaving(true);
    try {
      await fetchSave({
        data: {
          label: format(new Date(), "dd/MM/yyyy HH:mm"),
          entity_type: "campaign",
          entity_id: snapEntity,
          entity_name: `Base muda · ${result.listName}`,
          metrics: {
            list_size: result.listSize,
            window: result.n,
            dormant: last.dormant,
            dormant_pct: Number(last.dormantPct.toFixed(2)),
          },
        },
      });
      await snapsQ.refetch();
      toast.success("Foto da base salva");
    } catch (e: any) {
      toast.error(e?.message ?? "Não consegui salvar");
    } finally {
      setSaving(false);
    }
  }

  if (series.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Preciso de uma série com pelo menos 3 envios"
        description="A análise da base olha os últimos envios de um disparo recorrente. Ainda não encontrei nenhum."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Qual disparo analisar?"
        description="A análise olha quem abriu os últimos envios da série. Contatos que não abriram nenhum deles formam a base muda."
      >
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Série">
            <select value={seriesKey} onChange={(e) => { setSeriesKey(e.target.value); setListOverride(""); setResult(null); }} className={cn(selectClass, "min-w-[300px]")}>
              <option value="">Selecionar…</option>
              {series.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} ({s.sends.length} envios)
                </option>
              ))}
            </select>
          </Field>
          <Field label={detectedListId ? "Lista (detectada)" : "Lista"}>
            <select value={listId} onChange={(e) => setListOverride(e.target.value)} className={cn(selectClass, "min-w-[240px]")} disabled={!selected}>
              <option value="">Selecionar…</option>
              {(listsQ.data?.lists ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Últimos envios">
            <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setN(w)}
                  className={cn("rounded-md px-3 py-1 text-sm font-medium transition-all", n === w ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {w}
                </button>
              ))}
            </div>
          </Field>
          <Button onClick={run} disabled={!selected || !listId || running} className="h-9">
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? "Analisando…" : "Rodar análise"}
          </Button>
        </div>
        {selected && !detectedListId && (
          <p className="mt-3 text-xs text-muted-foreground">O ActiveCampaign não informou a lista deste disparo. Escolha a lista que recebe esta série.</p>
        )}
        {running && (
          <p className="mt-3 text-xs text-muted-foreground">Buscando as aberturas de cada envio no ActiveCampaign. Em listas grandes isso leva alguns segundos.</p>
        )}
      </Panel>

      {error && <Notice tone="bad">{error}</Notice>}

      {!result && !running && !error && (
        <EmptyState
          icon={MoonStar}
          title="Escolha a série e rode a análise"
          description="Vou mostrar quanto da sua base nunca abriu os últimos envios e quais empresas estão engajadas, esfriando ou sumindo."
        />
      )}

      {result && (
        <>
          <DormancyBlock result={result} onSave={saveBaseSnapshot} saving={saving} snaps={snapsQ.data?.snapshots ?? []} />
          <CompaniesBlock result={result} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function DormancyBlock({
  result,
  onSave,
  saving,
  snaps,
}: {
  result: Result;
  onSave: () => void;
  saving: boolean;
  snaps: { id: string; label: string; created_at: string; metrics: Record<string, number | string> }[];
}) {
  const last = result.dormancy[result.dormancy.length - 1];
  const tone = last.dormantPct >= 60 ? "bad" : last.dormantPct >= 40 ? "warn" : "good";
  const history = [...snaps]
    .reverse()
    .map((s) => ({ date: format(new Date(s.created_at), "dd/MM"), "Base muda": Number(s.metrics.dormant_pct ?? 0) }));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Base muda</h2>
        <p className="text-xs text-muted-foreground">
          {result.listName} · últimos {result.n} envios de {result.seriesLabel}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Users} label="Contatos ativos na lista" value={result.listSize.toLocaleString("pt-BR")} sub="status ativo no ActiveCampaign" />
        <Stat label={`Abriram ao menos 1 dos ${result.n} envios`} value={last.active.toLocaleString("pt-BR")} sub={`${(100 - last.dormantPct).toFixed(1).replace(".", ",")}% da base`} />
        <Stat
          icon={MoonStar}
          label={`Não abriram nenhum dos ${result.n} envios`}
          value={`${last.dormantPct.toFixed(1).replace(".", ",")}%`}
          delta={`${last.dormant.toLocaleString("pt-BR")} contatos`}
          tone={tone}
          sub="base muda"
        />
      </div>

      <Panel title="Quanto da base fica de fora conforme a janela cresce" description="Quanto mais envios você considera, menos contatos ficam de fora. Se ainda sobra muita gente depois de vários envios, essa parte da base provavelmente não vai responder.">
        <div className="space-y-3">
          {result.dormancy.map((r) => (
            <div key={r.window} className="flex items-center gap-4">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {r.window === 1 ? "Último envio" : `Últimos ${r.window} envios`}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(r.dormantPct, 100)}%` }} />
              </div>
              <span className="w-16 text-right text-sm font-medium tabular-nums">{r.dormantPct.toFixed(1).replace(".", ",")}%</span>
              <span className="hidden w-28 text-right text-xs tabular-nums text-muted-foreground sm:block">{r.dormant.toLocaleString("pt-BR")} contatos</span>
            </div>
          ))}
        </div>
        <div className="mt-5">
          <Notice tone="info">
            Leia como um piso: aberturas automáticas de proteção de privacidade (como o Apple Mail) contam como abertura, então a base realmente muda é igual ou maior que a mostrada.
          </Notice>
        </div>
      </Panel>

      <Panel
        title="Evolução da base muda"
        description="O ActiveCampaign não guarda esse histórico. Salve uma foto de tempos em tempos (por exemplo, todo mês) para mostrar se a base está esquentando ou esfriando."
        actions={
          <Button size="sm" variant="outline" onClick={onSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Salvando…" : "Salvar foto de hoje"}
          </Button>
        }
      >
        {history.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            {history.length === 0 ? "Nenhuma foto salva ainda." : "Uma foto salva. Salve outra em outra data para ver a tendência."}
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
                <Line type="monotone" dataKey="Base muda" stroke="#0660FE" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </section>
  );
}

function CompaniesBlock({ result }: { result: Result }) {
  const [filter, setFilter] = useState<"all" | "cooling" | "active">("all");
  const real = result.companies.filter((c) => c.key !== "__none__");
  const active = real.filter((c) => c.status === "active");
  const cooling = real.filter((c) => c.status === "cooling");
  const rows = filter === "all" ? real : filter === "cooling" ? cooling : active;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Engajamento por empresa</h2>
        <p className="text-xs text-muted-foreground">
          Empresas com pelo menos um contato que abriu algum dos últimos {result.n} envios. Esfriando = abriram antes, mas nenhum contato abriu os 2 envios mais recentes.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Building2} label="Empresas com abertura" value={real.length.toLocaleString("pt-BR")} sub={`${result.contactsWithOpens.toLocaleString("pt-BR")} contatos abriram`} />
        <Stat label="Ativas" value={active.length.toLocaleString("pt-BR")} tone="good" sub="abriram nos 2 envios mais recentes" />
        <Stat icon={Snowflake} label="Esfriando" value={cooling.length.toLocaleString("pt-BR")} tone={cooling.length > 0 ? "warn" : "neutral"} sub="abriram antes e sumiram" />
      </div>

      {result.truncatedLinks && <Notice>A base tem mais vínculos contato-empresa do que consigo ler de uma vez. Parte das empresas pode aparecer como "Sem empresa".</Notice>}
      {result.failed > 0 && <Notice>{result.failed} envio(s) não puderam ser lidos no ActiveCampaign. Os números acima podem estar subestimados.</Notice>}

      <Panel
        title="Empresas"
        flush
        actions={
          <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
            {([["all", "Todas"], ["cooling", "Esfriando"], ["active", "Ativas"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn("rounded-md px-3 py-1 text-xs font-medium transition-all", filter === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Nenhuma empresa neste filtro.</p>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Empresa</th>
                  <th className="px-3 py-3 text-left font-medium">Situação</th>
                  <th className="px-3 py-3 text-right font-medium">Contatos que abriram</th>
                  <th className="px-3 py-3 text-right font-medium">Aberturas</th>
                  <th className="px-6 py-3 text-right font-medium">Última abertura</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((c) => (
                  <tr key={c.key} className="border-t border-border hover:bg-surface/60">
                    <td className="px-6 py-3 text-[13px] font-medium">{c.name}</td>
                    <td className="px-3 py-3">
                      {c.status === "active" ? <Tag tone="good">Ativa</Tag> : <Tag tone="warn">Esfriando</Tag>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.engagedContacts}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.opens}</td>
                    <td className="px-6 py-3 text-right text-xs text-muted-foreground">
                      {c.lastOpenedIdx === 0 ? "No último envio" : `${c.lastOpenedIdx} envios atrás`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        Empresas que nunca abriram nenhum envio não aparecem: o ActiveCampaign não informa a lista de destinatários de cada campanha, só quem abriu.
      </p>
    </section>
  );
}
