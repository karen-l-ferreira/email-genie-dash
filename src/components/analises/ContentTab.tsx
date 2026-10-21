import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Microscope, Play } from "lucide-react";
import { getEmailFeatures, type Campaign } from "@/lib/ac.functions";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, Panel, selectClass, Tag, type Tone } from "@/components/app/ui-kit";
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
  boa: { label: "Confiança boa", tone: "good" },
  moderada: { label: "Confiança moderada", tone: "warn" },
  baixa: { label: "Poucos dados", tone: "neutral" },
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

  const [category, setCategory] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ dims: DimensionResult[]; used: number; failed: number; category: string } | null>(null);

  const pool = category ? sends.filter((s) => categoryOf(s.name) === category) : sends;

  async function run() {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const picked = pool.slice(0, MAX_CAMPAIGNS);
      const { features, failed } = await fetchFeatures({ data: { ids: picked.map((s) => s.id) } });
      const joined = joinFeatures(picked, features);
      setResults({ dims: analyzeDimensions(joined), used: joined.length, failed, category });
    } catch (e: any) {
      setError(e?.message ?? "Não consegui ler os e-mails no ActiveCampaign.");
    } finally {
      setRunning(false);
    }
  }

  if (sends.length < 10) {
    return (
      <EmptyState
        icon={Microscope}
        title="Ainda há poucos envios para achar padrões"
        description={`Preciso de pelo menos 10 envios com ${MIN_SENT}+ destinatários. Encontrei ${sends.length}.`}
      />
    );
  }

  const ranked = results ? rankDimensions(results.dims) : [];

  return (
    <div className="space-y-6">
      <Panel
        title="O que no e-mail explica o resultado?"
        description="Leio o assunto e o HTML de cada envio e comparo o desempenho de quem tem cada característica. Isso mostra correlação, não prova causa: públicos diferentes também mudam o resultado."
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Tipo de disparo</span>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setResults(null); }} className={cn(selectClass, "min-w-[260px]")}>
              <option value="">Todos ({sends.length} envios)</option>
              {categories.map(([c, n]) => (
                <option key={c} value={c}>
                  {c} ({n} envios)
                </option>
              ))}
            </select>
          </label>
          <Button onClick={run} disabled={running || pool.length < 10} className="h-9">
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? "Lendo e-mails…" : `Analisar ${Math.min(pool.length, MAX_CAMPAIGNS)} envios`}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Comparar só envios do mesmo tipo evita misturar públicos diferentes (por exemplo, newsletter com prospecção). Leva cerca de 1 minuto.
        </p>
      </Panel>

      {error && <Notice tone="bad">{error}</Notice>}

      {results && (
        <>
          {results.failed > 0 && <Notice>{results.failed} e-mail(s) não puderam ser lidos e ficaram de fora.</Notice>}

          {ranked.length === 0 ? (
            <EmptyState
              icon={Microscope}
              title="Ainda não dá para separar padrões"
              description={`Com ${results.used} envios analisados, nenhuma característica tem pelo menos ${MIN_PER_BUCKET} envios em cada lado da comparação.`}
            />
          ) : (
            <>
              <section>
                <h2 className="mb-3 text-base font-semibold tracking-tight">Maiores diferenças de CTR</h2>
                <div className="grid gap-4 lg:grid-cols-3">
                  {ranked.slice(0, 3).map((d) => (
                    <Finding key={d.key} d={d} />
                  ))}
                </div>
              </section>

              <Panel title="Todas as características" description={`${results.used} envios analisados${results.category ? ` · ${results.category}` : ""}. Só entram na comparação grupos com ${MIN_PER_BUCKET}+ envios.`} flush>
                <div className="divide-y divide-border">
                  {results.dims.map((d) => (
                    <DimensionTable key={d.key} d={d} />
                  ))}
                </div>
              </Panel>
            </>
          )}
        </>
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
        <strong className="font-semibold">{d.best.bucket}</strong> teve CTR{" "}
        <strong className="font-semibold text-success">{fmtPct(d.best.ctr, 2)}</strong>, contra{" "}
        <strong className="font-semibold">{fmtPct(d.worst.ctr, 2)}</strong> de {d.worst.bucket.toLowerCase()}.
      </p>
      <div className="mt-3 text-xs text-muted-foreground">
        {fmtRel(d.gapRel)} de diferença · {d.best.n} contra {d.worst.n} envios
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
        <div className="grid grid-cols-[170px_1fr_64px_64px_56px] gap-3 text-[11px] text-muted-foreground/80">
          <span />
          <span />
          <span className="text-right">Abertura</span>
          <span className="text-right">CTR</span>
          <span />
        </div>
      </div>
    </div>
  );
}
