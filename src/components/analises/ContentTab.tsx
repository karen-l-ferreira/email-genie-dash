import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Microscope } from "lucide-react";
import { getEmailFeatures, type Campaign } from "@/lib/ac.functions";
import { Advice, EmptyState, Explainer, Notice, Panel, selectClass, Tag, type Tone } from "@/components/app/ui-kit";
import { cn } from "@/lib/utils";
import { toSendMetrics, fmtPct, fmtRel, type SendMetrics } from "@/lib/analysis/series";
import {
  analyzeDimensions,
  joinFeatures,
  MIN_PER_BUCKET,
  rankDimensions,
  type DimensionResult,
} from "@/lib/analysis/content";

const MAX_CAMPAIGNS = 60;
const MIN_SENT = 200; // tiny sends make rates too noisy to compare

function categoryOf(name: string): string {
  return name.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim() ?? "Sem categoria";
}

const CONFIDENCE: Record<DimensionResult["confidence"], { label: string; tone: Tone }> = {
  boa: { label: "Dá para confiar", tone: "good" },
  moderada: { label: "Confiança média", tone: "warn" },
  baixa: { label: "Pode ser coincidência", tone: "neutral" },
};

export function ContentTab({ campaigns }: { campaigns: Campaign[] }) {
  const fetchFeatures = useServerFn(getEmailFeatures);

  const sends = useMemo(
    () =>
      campaigns
        .map(toSendMetrics)
        .filter((s): s is SendMetrics => s !== null && s.sent >= MIN_SENT)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [campaigns],
  );
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    sends.forEach((s) => m.set(categoryOf(s.name), (m.get(categoryOf(s.name)) ?? 0) + 1));
    return [...m.entries()].filter(([, n]) => n >= 8).sort((a, b) => b[1] - a[1]);
  }, [sends]);

  // Default to the biggest category so different audiences don't get mixed together.
  const [picked, setPicked] = useState<string | null>(null);
  const category = picked ?? categories[0]?.[0] ?? "";
  const pool = useMemo(
    () => (category ? sends.filter((s) => categoryOf(s.name) === category) : sends).slice(0, MAX_CAMPAIGNS),
    [sends, category],
  );

  // Runs by itself and is cached, so coming back to the tab is instant.
  const q = useQuery({
    queryKey: ["content-analysis", category, pool.map((s) => s.id).join(",")],
    enabled: pool.length >= 10,
    retry: false,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { features, failed } = await fetchFeatures({ data: { ids: pool.map((s) => s.id) } });
      const joined = joinFeatures(pool, features);
      return { dims: analyzeDimensions(joined), used: joined.length, failed };
    },
  });

  const ranked = q.data ? rankDimensions(q.data.dims) : [];

  return (
    <div>
      <Explainer>
        Leio o assunto e o conteúdo dos seus e-mails e comparo <strong>quanta gente clicou</strong> em quem tem cada característica (assunto curto ou longo, quantidade de links,
        onde fica o botão...). Serve para descobrir o que repetir nos próximos envios. A análise começa sozinha e leva cerca de 1 minuto na primeira vez.
      </Explainer>

      {sends.length < 10 ? (
        <EmptyState
          icon={Microscope}
          title="Ainda há poucos envios para achar padrões"
          description={`Preciso de pelo menos 10 envios com ${MIN_SENT} ou mais destinatários. Encontrei ${sends.length}.`}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card px-5 py-4 shadow-card">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Comparar e-mails do tipo</span>
              <select value={category} onChange={(e) => setPicked(e.target.value)} className={cn(selectClass, "min-w-[260px]")}>
                <option value="">Todos ({sends.length} envios)</option>
                {categories.map(([c, n]) => (
                  <option key={c} value={c}>
                    {c} ({n} envios)
                  </option>
                ))}
              </select>
            </label>
            <p className="max-w-md pb-2 text-xs leading-relaxed text-muted-foreground">
              Comparar só e-mails do mesmo tipo evita misturar públicos diferentes (por exemplo, newsletter com prospecção).
            </p>
            {q.isFetching && (
              <span className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lendo {pool.length} e-mails no ActiveCampaign…
              </span>
            )}
          </div>

          {q.isError && <Notice tone="bad">{(q.error as Error).message}</Notice>}

          {q.data && (
            <>
              {q.data.failed > 0 && <Notice>{q.data.failed} e-mail(s) não puderam ser lidos e ficaram de fora.</Notice>}

              {ranked.length === 0 ? (
                <EmptyState
                  icon={Microscope}
                  title="Ainda não dá para separar padrões"
                  description={`Com ${q.data.used} e-mails analisados, nenhuma característica aparece em pelo menos ${MIN_PER_BUCKET} envios dos dois lados da comparação.`}
                />
              ) : (
                <>
                  <section>
                    <h2 className="text-base font-semibold tracking-tight">O que mais separa os e-mails que funcionam dos que não funcionam</h2>
                    <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
                      Em ordem de diferença. Isso mostra uma relação, não prova que foi aquilo que causou o resultado: o público de cada envio também pesa.
                    </p>
                    <div className="grid gap-4 lg:grid-cols-3">
                      {ranked.slice(0, 3).map((d) => (
                        <Finding key={d.key} d={d} />
                      ))}
                    </div>
                  </section>

                  <Panel
                    title="Todas as características"
                    description={`${q.data.used} e-mails analisados${category ? ` · tipo ${category}` : ""}. Só comparo grupos com ${MIN_PER_BUCKET} ou mais envios. A barra verde é a que mais teve cliques.`}
                    flush
                  >
                    <div className="divide-y divide-border">
                      {q.data.dims.map((d) => (
                        <DimensionTable key={d.key} d={d} />
                      ))}
                    </div>
                  </Panel>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Finding({ d }: { d: DimensionResult }) {
  if (!d.best || !d.worst) return null;
  const c = CONFIDENCE[d.confidence];
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{d.label}</span>
        <Tag tone={c.tone}>{c.label}</Tag>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-foreground">
        E-mails <strong className="font-semibold">{d.best.bucket.toLowerCase()}</strong> tiveram clique de{" "}
        <strong className="font-semibold text-success">{fmtPct(d.best.ctr, 2)}</strong>, contra{" "}
        <strong className="font-semibold">{fmtPct(d.worst.ctr, 2)}</strong> dos e-mails {d.worst.bucket.toLowerCase()}.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {fmtRel(d.gapRel)} de diferença, em {d.best.n} contra {d.worst.n} envios.
      </p>
      <div className="mt-3 border-t border-border pt-3">
        <Advice tone="good">{d.confidence === "baixa" ? `teste "${d.best.bucket.toLowerCase()}" mais vezes antes de tirar conclusão.` : `use "${d.best.bucket.toLowerCase()}" nos próximos envios.`}</Advice>
      </div>
    </div>
  );
}

function DimensionTable({ d }: { d: DimensionResult }) {
  const max = Math.max(...d.buckets.map((b) => b.ctr), 0.0001);
  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">{d.label}</h3>
        {d.best && d.worst && <Tag tone={CONFIDENCE[d.confidence].tone}>{CONFIDENCE[d.confidence].label}</Tag>}
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[170px_1fr_64px_64px_56px] gap-3 text-[11px] text-muted-foreground/80">
          <span />
          <span />
          <span className="text-right">Abriram</span>
          <span className="text-right">Clicaram</span>
          <span />
        </div>
        {d.buckets.map((b) => {
          const usable = b.n >= MIN_PER_BUCKET;
          return (
            <div key={b.bucket} className={cn("grid grid-cols-[170px_1fr_64px_64px_56px] items-center gap-3", !usable && "opacity-50")}>
              <span className="truncate text-xs text-muted-foreground">{b.bucket}</span>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", d.best?.bucket === b.bucket ? "bg-success/80" : "bg-primary/50")}
                  style={{ width: `${(b.ctr / max) * 100}%` }}
                />
              </div>
              <span className="text-right text-xs tabular-nums">{fmtPct(b.open_rate)}</span>
              <span className="text-right text-xs font-medium tabular-nums">{fmtPct(b.ctr, 2)}</span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">{b.n} env.</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
