import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, MoonStar, Save, Snowflake, Users } from "lucide-react";
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
import { Advice, EmptyState, Explainer, Notice, Panel, selectClass, Stat, Tag } from "@/components/app/ui-kit";
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

  // Only recurring sends with enough editions make a meaningful window
  const series = useMemo(() => buildSeries(campaigns, 3), [campaigns]);
  const listsQ = useQuery({ queryKey: ["ac-lists"], queryFn: () => fetchLists(), staleTime: 30 * 60 * 1000 });

  // Default: the most recent recurring send that reaches a real audience
  const defaultKey = useMemo(
    () => (series.find((s) => s.sends[0].sent >= 500) ?? series[0])?.key ?? "",
    [series],
  );
  const [pickedKey, setPickedKey] = useState("");
  const seriesKey = pickedKey || defaultKey;
  const [listOverride, setListOverride] = useState("");
  const [n, setN] = useState(5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = series.find((s) => s.key === seriesKey) ?? null;
  const detectedListId = selected?.sends[0].listId ?? "";
  const listId = listOverride || detectedListId;

  // Runs by itself when the screen opens and whenever an option changes.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      setRunning(true);
      setError(null);
      try {
        const ids = selected.sends.slice(0, n).map((s) => s.id);
        const [{ size }, history, links] = await Promise.all([
          fetchSize({ data: listId ? { listId } : {} }),
          fetchHistory({ data: { ids } }),
          fetchLinks(),
        ]);
        if (cancelled) return;
        setResult({
          seriesLabel: selected.label,
          listId,
          listName: listId
            ? (listsQ.data?.lists.find((l) => l.id === listId)?.name ?? `Lista ${listId}`)
            : "Todos os contatos ativos",
          listSize: size,
          n: ids.length,
          dormancy: dormancyRows(size, history.opened, ids.length),
          companies: buildCompanyEngagement(history.opened, links.links, links.names),
          contactsWithOpens: Object.keys(history.opened).length,
          failed: history.failed,
          truncatedLinks: links.truncated,
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Não consegui concluir a análise.");
      } finally {
        if (!cancelled) setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey, listId, n]);

  const snapEntity = result ? `base-muda:${result.listId || "todos"}` : "";
  const snapsQ = useQuery({
    queryKey: ["base-muda-history", snapEntity],
    queryFn: () => fetchSnaps({ data: { entity_id: snapEntity } }),
    enabled: !!snapEntity,
  });

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
          entity_name: `Contatos que não abrem · ${result.listName}`,
          metrics: {
            list_size: result.listSize,
            window: result.n,
            dormant: last.dormant,
            dormant_pct: Number(last.dormantPct.toFixed(2)),
          },
        },
      });
      await snapsQ.refetch();
      toast.success("Foto salva");
    } catch (e: any) {
      toast.error(e?.message ?? "Não consegui salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Explainer>
        Mostra quantos contatos da sua lista <strong>não abriram nenhum dos últimos e-mails</strong> e quais empresas pararam de abrir. É a parte da base que provavelmente
        não está vendo o que você manda. A análise começa sozinha com o disparo recorrente mais recente.
      </Explainer>

      {series.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Preciso de um disparo com pelo menos 3 edições"
          description="A análise olha os últimos e-mails de um disparo recorrente. Ainda não encontrei nenhum."
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card px-5 py-4 shadow-card">
            <Field label="Analisando o disparo">
              <select value={seriesKey} onChange={(e) => { setPickedKey(e.target.value); setListOverride(""); }} className={cn(selectClass, "min-w-[280px]")}>
                {series.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label} ({s.sends.length} edições)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Considerando os últimos">
              <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setN(w)}
                    className={cn("rounded-md px-3 py-1 text-sm font-medium transition-all", n === w ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {w} e-mails
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Lista de contatos">
              <select value={listOverride} onChange={(e) => setListOverride(e.target.value)} className={cn(selectClass, "min-w-[220px]")}>
                <option value="">{detectedListId ? "A lista deste disparo" : "Todos os contatos ativos"}</option>
                {(listsQ.data?.lists ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            {running && (
              <span className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando as aberturas no ActiveCampaign. Em listas grandes leva alguns segundos.
              </span>
            )}
          </div>

          {error && <Notice tone="bad">{error}</Notice>}

          {result && (
            <>
              <DormancyBlock result={result} onSave={saveBaseSnapshot} saving={saving} snaps={snapsQ.data?.snapshots ?? []} />
              <CompaniesBlock result={result} />
            </>
          )}
        </div>
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

function pct(v: number) {
  return `${v.toFixed(0)}%`;
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
  const tone = last.dormantPct >= 50 ? "bad" : last.dormantPct >= 30 ? "warn" : "good";
  const history = [...snaps]
    .reverse()
    .map((s) => ({ date: format(new Date(s.created_at), "dd/MM"), "Contatos que não abrem": Number(s.metrics.dormant_pct ?? 0) }));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Contatos que não abrem</h2>
        <p className="text-xs text-muted-foreground">
          {result.listName} · últimos {result.n} e-mails de {result.seriesLabel}
        </p>
      </div>

      <Panel>
        <p className="text-base leading-relaxed text-foreground">
          De cada 100 contatos, <strong className="font-semibold">{pct(last.dormantPct)}</strong> não abriram nenhum dos últimos {result.n} e-mails.
        </p>
        <div className="mt-3">
          <Advice tone={tone}>
            {last.dormantPct >= 50
              ? "Mais da metade da base não está vendo seus e-mails. Vale uma campanha para reativar esses contatos e, se não responderem, tirá-los da lista para melhorar a reputação de envio."
              : last.dormantPct >= 30
                ? "Uma parte relevante da base está parada. Acompanhe mês a mês (botão abaixo) e, se crescer, faça uma campanha de reativação."
                : "Boa saúde: a maior parte da base continua abrindo. Só acompanhe para ver se isso se mantém."}
          </Advice>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Users} label="Contatos ativos na lista" value={result.listSize.toLocaleString("pt-BR")} sub="pessoas que podem receber seus e-mails" />
        <Stat label="Abriram pelo menos 1 e-mail" value={last.active.toLocaleString("pt-BR")} sub={`${pct(100 - last.dormantPct)} da lista`} />
        <Stat
          icon={MoonStar}
          label="Não abriram nenhum"
          value={last.dormant.toLocaleString("pt-BR")}
          delta={pct(last.dormantPct)}
          tone={tone}
          sub={`nos últimos ${result.n} e-mails`}
        />
      </div>

      <Panel
        title="E se eu olhar mais e-mails para trás?"
        description="Quanto mais e-mails você considera, mais gente aparece como ativa. Se ainda sobra muita gente depois de vários e-mails, essa parte da lista dificilmente vai responder."
      >
        <div className="space-y-3">
          {result.dormancy.map((r) => (
            <div key={r.window} className="flex items-center gap-4">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{r.window === 1 ? "Só o último e-mail" : `Últimos ${r.window} e-mails`}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(r.dormantPct, 100)}%` }} />
              </div>
              <span className="w-12 text-right text-sm font-medium tabular-nums">{pct(r.dormantPct)}</span>
              <span className="hidden w-28 text-right text-xs tabular-nums text-muted-foreground sm:block">{r.dormant.toLocaleString("pt-BR")} contatos</span>
            </div>
          ))}
        </div>
        <div className="mt-5">
          <Notice tone="info">
            Leia como um mínimo: algumas ferramentas de e-mail (como o Apple Mail) abrem a mensagem sozinhas, e isso conta como abertura. A parte realmente parada da lista é igual ou maior.
          </Notice>
        </div>
      </Panel>

      <Panel
        title="Está melhorando ou piorando?"
        description="O ActiveCampaign não guarda esse histórico. Salve uma foto de tempos em tempos (por exemplo, todo mês) e o gráfico passa a mostrar a evolução."
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
                <Line type="monotone" dataKey="Contatos que não abrem" stroke="#0660FE" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </section>
  );
}

function CompaniesBlock({ result }: { result: Result }) {
  const [filter, setFilter] = useState<"all" | "cooling" | "active">("cooling");
  const real = result.companies.filter((c) => c.key !== "__none__");
  const active = real.filter((c) => c.status === "active");
  const cooling = real.filter((c) => c.status === "cooling");
  const rows = filter === "all" ? real : filter === "cooling" ? cooling : active;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Empresas que pararam de abrir</h2>
        <p className="text-xs text-muted-foreground">Cada empresa é o conjunto de contatos ligados a ela no ActiveCampaign.</p>
      </div>

      <Panel>
        <p className="text-base leading-relaxed text-foreground">
          <strong className="font-semibold">{active.length}</strong> empresas abriram os 2 e-mails mais recentes e{" "}
          <strong className="font-semibold">{cooling.length}</strong> abriram antes, mas pararam.
        </p>
        {cooling.length > 0 && (
          <div className="mt-3">
            <Advice tone="warn">
              Estas são as empresas que mostravam interesse e esfriaram. São as melhores candidatas para um contato direto (ligação ou mensagem do comercial).
            </Advice>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Building2} label="Empresas que abriram algo" value={real.length.toLocaleString("pt-BR")} sub={`${result.contactsWithOpens.toLocaleString("pt-BR")} contatos`} />
        <Stat label="Ativas" value={active.length.toLocaleString("pt-BR")} sub="abriram nos 2 e-mails mais recentes" />
        <Stat icon={Snowflake} label="Esfriando" value={cooling.length.toLocaleString("pt-BR")} sub="abriram antes e sumiram" />
      </div>

      {result.truncatedLinks && <Notice>A base tem mais vínculos entre contato e empresa do que consigo ler de uma vez. Parte das empresas pode aparecer como "Sem empresa".</Notice>}
      {result.failed > 0 && <Notice>{result.failed} e-mail(s) não puderam ser lidos no ActiveCampaign. Os números podem estar abaixo do real.</Notice>}

      <Panel
        title="Lista de empresas"
        flush
        actions={
          <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
            {([["cooling", "Esfriando"], ["active", "Ativas"], ["all", "Todas"]] as const).map(([k, label]) => (
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
                  <th className="px-3 py-3 text-right font-medium">Pessoas que abriram</th>
                  <th className="px-3 py-3 text-right font-medium">Aberturas</th>
                  <th className="px-6 py-3 text-right font-medium">Última abertura</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((c) => (
                  <tr key={c.key} className="border-t border-border hover:bg-surface/60">
                    <td className="px-6 py-3 text-[13px] font-medium">{c.name}</td>
                    <td className="px-3 py-3">{c.status === "active" ? <Tag tone="good">Ativa</Tag> : <Tag tone="warn">Esfriando</Tag>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.engagedContacts}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.opens}</td>
                    <td className="px-6 py-3 text-right text-xs text-muted-foreground">
                      {c.lastOpenedIdx === 0 ? "No último e-mail" : `${c.lastOpenedIdx} e-mails atrás`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        Empresas que nunca abriram nada não aparecem: o ActiveCampaign informa só quem abriu, não quem recebeu.
      </p>
    </section>
  );
}
