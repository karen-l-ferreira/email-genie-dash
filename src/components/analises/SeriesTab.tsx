import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, CheckCircle2, ClipboardCopy, Lightbulb, Search, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Campaign } from "@/lib/ac.functions";
import { Input } from "@/components/ui/input";
import { EmptyState, Notice, Panel, Segmented, selectClass, Stat, Tag, type Tone } from "@/components/app/ui-kit";
import { cn } from "@/lib/utils";
import {
  assessAll,
  buildMeetingSummary,
  buildSeries,
  compareLatest,
  fmtDeltaPp,
  fmtPct,
  fmtRel,
  HIGHER_IS_BETTER,
  METRIC_HELP,
  METRIC_LABEL,
  parseSendDate,
  seriesByKeyword,
  type MetricKey,
  type SendMetrics,
  type SeriesAssessment,
  type Severity,
} from "@/lib/analysis/series";

const SEVERITY_UI: Record<Severity, { label: string; tone: Tone }> = {
  critical: { label: "Queda forte", tone: "bad" },
  warning: { label: "Atenção", tone: "warn" },
  positive: { label: "Acima do padrão", tone: "good" },
  ok: { label: "Dentro do padrão", tone: "neutral" },
  insufficient: { label: "Poucos dados", tone: "neutral" },
};

type Window = "30" | "90" | "all";

export function SeriesTab({ campaigns }: { campaigns: Campaign[] }) {
  const allSeries = useMemo(() => buildSeries(campaigns), [campaigns]);
  const assessments = useMemo(() => assessAll(allSeries), [allSeries]);

  const [windowKey, setWindowKey] = useState<Window>("90");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const visible = useMemo(() => {
    if (windowKey === "all") return assessments;
    const since = subDays(new Date(), Number(windowKey));
    return assessments.filter((a) => parseSendDate(a.latest.date) >= since);
  }, [assessments, windowKey]);

  const flagged = visible.filter((a) => a.severity === "critical" || a.severity === "warning" || a.severity === "positive");

  const activeKey = selectedKey ?? flagged[0]?.series.key ?? allSeries[0]?.key ?? null;

  const { title, sends } = useMemo((): { title: string; sends: SendMetrics[] } => {
    if (keyword.trim()) return { title: `"${keyword.trim()}"`, sends: seriesByKeyword(campaigns, keyword) };
    const s = allSeries.find((x) => x.key === activeKey);
    return s ? { title: s.label, sends: s.sends } : { title: "", sends: [] };
  }, [keyword, campaigns, allSeries, activeKey]);

  if (allSeries.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Ainda não há séries para comparar"
        description="Uma série é um disparo recorrente (por exemplo, a newsletter que sai toda semana). Preciso de pelo menos 2 envios com o mesmo nome base."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Radar de desvios"
        description="Cada série é comparada com o próprio histórico. Só aparece aqui o que fugiu do padrão normal dela, não só da média geral."
        actions={
          <Segmented<Window>
            size="sm"
            value={windowKey}
            onChange={setWindowKey}
            options={[
              { value: "30", label: "30 dias" },
              { value: "90", label: "90 dias" },
              { value: "all", label: "Tudo" },
            ]}
          />
        }
        flush
      >
        {flagged.length === 0 ? (
          <div className="flex items-center gap-3 px-6 py-8 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Nenhuma série com disparo fora do padrão neste período ({visible.length} séries analisadas).
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {flagged.map((a) => (
              <AlertRow key={a.series.key} a={a} active={a.series.key === activeKey && !keyword} onSelect={() => { setKeyword(""); setSelectedKey(a.series.key); }} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Análise detalhada">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={keyword ? "" : (activeKey ?? "")}
            onChange={(e) => {
              setKeyword("");
              setSelectedKey(e.target.value);
            }}
            className={cn(selectClass, "min-w-[320px] max-w-full")}
          >
            {keyword && <option value="">Busca por palavra-chave</option>}
            {allSeries.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.sends.length} envios)
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Palavra no nome (ex.: churn)" className="h-9 pl-9" />
          </div>
        </div>
      </Panel>

      <SeriesDetail title={title} sends={sends} />
    </div>
  );
}

function AlertRow({ a, active, onSelect }: { a: SeriesAssessment; active: boolean; onSelect: () => void }) {
  const ui = SEVERITY_UI[a.severity];
  const c = a.comparison;
  const Icon = a.severity === "positive" ? TrendingUp : TrendingDown;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn("flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-surface", active && "bg-surface")}
      >
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", a.severity === "positive" ? "bg-success/10 text-success" : a.severity === "critical" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning")}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{a.series.label}</span>
            <Tag tone={ui.tone}>{ui.label}</Tag>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Último envio em {format(parseSendDate(a.latest.date), "d 'de' MMM", { locale: ptBR })} · {a.latest.sent.toLocaleString("pt-BR")} envios ·{" "}
            {a.series.sends.length} na série
          </div>
        </div>
        {c && (
          <div className="hidden gap-8 text-right sm:flex">
            <MiniMetric label="Abertura" value={fmtPct(a.latest.open_rate)} rel={c.delta.open_rate.rel} />
            <MiniMetric label="CTR" value={fmtPct(a.latest.ctr, 2)} rel={c.delta.ctr.rel} />
          </div>
        )}
      </button>
    </li>
  );
}

function MiniMetric({ label, value, rel }: { label: string; value: string; rel: number }) {
  const tone = Math.abs(rel) < 0.05 ? "text-muted-foreground" : rel > 0 ? "text-success" : "text-destructive";
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className={cn("text-[11px] font-medium tabular-nums", tone)}>{fmtRel(rel)} vs média</div>
    </div>
  );
}

function deltaTone(metric: MetricKey, abs: number, rel: number): Tone {
  if (Math.abs(rel) < 0.05) return "neutral";
  const better = HIGHER_IS_BETTER[metric] ? abs > 0 : abs < 0;
  return better ? "good" : "bad";
}

function SeriesDetail({ title, sends }: { title: string; sends: SendMetrics[] }) {
  const cmp = useMemo(() => compareLatest(sends), [sends]);

  if (!title) return null;
  if (!cmp) {
    return (
      <EmptyState
        icon={Activity}
        title={`Só encontrei ${sends.length} envio(s) para ${title}`}
        description="Preciso de pelo menos 2 envios para comparar."
      />
    );
  }

  const headline: MetricKey[] = ["open_rate", "ctr", "ctor"];
  const secondary: MetricKey[] = ["bounce_rate", "unsub_rate"];
  const digits = (m: MetricKey) => (m === "ctr" || m === "bounce_rate" || m === "unsub_rate" ? 2 : 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Último envio em {format(parseSendDate(cmp.latest.date), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })} comparado com a média ponderada dos{" "}
            {cmp.baselineCount} anteriores
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(buildMeetingSummary(title, cmp))
              .then(() => toast.success("Resumo copiado"))
              .catch(() => toast.error("Não consegui copiar o resumo"));
          }}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-colors hover:bg-surface"
        >
          <ClipboardCopy className="h-4 w-4" />
          Copiar resumo para reunião
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {headline.map((m) => (
          <Stat
            key={m}
            label={METRIC_LABEL[m]}
            value={fmtPct(cmp.latest[m], digits(m))}
            delta={`${fmtDeltaPp(cmp.delta[m].abs, digits(m))} (${fmtRel(cmp.delta[m].rel)})`}
            tone={deltaTone(m, cmp.delta[m].abs, cmp.delta[m].rel)}
            sub={`média anterior ${fmtPct(cmp.baseline[m], digits(m))}`}
          />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {secondary.map((m) => (
          <Stat
            key={m}
            label={METRIC_LABEL[m]}
            value={fmtPct(cmp.latest[m], 2)}
            delta={`${fmtDeltaPp(cmp.delta[m].abs, 2)} (${fmtRel(cmp.delta[m].rel)})`}
            tone={deltaTone(m, cmp.delta[m].abs, cmp.delta[m].rel)}
            sub={`média anterior ${fmtPct(cmp.baseline[m], 2)}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">CTOR</strong>: {METRIC_HELP.ctor.split(": ")[1]}. É ele que separa "ninguém abriu" de "abriram e não clicaram".
      </p>

      <Panel title="Leitura do resultado">
        <ul className="space-y-3">
          {cmp.diagnosis.map((d, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-foreground/90">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {d}
            </li>
          ))}
        </ul>
        {cmp.warnings.length > 0 && (
          <div className="mt-5 space-y-2">
            {cmp.warnings.map((w, i) => (
              <Notice key={i}>
                <span className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  {w}
                </span>
              </Notice>
            ))}
          </div>
        )}
      </Panel>

      <TrendChart sends={sends} />
      <HistoryTable sends={sends} />
    </div>
  );
}

function TrendChart({ sends }: { sends: SendMetrics[] }) {
  const data = [...sends].reverse().map((s) => ({
    date: format(parseSendDate(s.date), "dd/MM"),
    Abertura: Number(s.open_rate.toFixed(1)),
    CTR: Number(s.ctr.toFixed(2)),
    CTOR: Number(s.ctor.toFixed(1)),
  }));
  return (
    <Panel title="Evolução por envio" description="Percentuais de cada disparo, do mais antigo ao mais recente.">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} unit="%" />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Abertura" stroke="#0660FE" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="CTR" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="CTOR" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function HistoryTable({ sends }: { sends: SendMetrics[] }) {
  return (
    <Panel title="Histórico da série" description="A variação em cada célula é contra o envio imediatamente anterior." flush>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs text-muted-foreground">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Disparo</th>
              <th className="px-3 py-3 text-left font-medium">Data</th>
              <th className="px-3 py-3 text-right font-medium">Envios</th>
              <th className="px-3 py-3 text-right font-medium">Abertura</th>
              <th className="px-3 py-3 text-right font-medium">CTR</th>
              <th className="px-3 py-3 text-right font-medium">CTOR</th>
              <th className="px-3 py-3 text-right font-medium">Bounce</th>
              <th className="px-6 py-3 text-right font-medium">Descad.</th>
            </tr>
          </thead>
          <tbody>
            {sends.map((s, i) => {
              const prev = sends[i + 1];
              return (
                <tr key={s.id} className="border-t border-border transition-colors hover:bg-surface/60">
                  <td className="max-w-[320px] truncate px-6 py-3 text-[13px] font-medium">{s.name}</td>
                  <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">{format(parseSendDate(s.date), "dd/MM/yy")}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{s.sent.toLocaleString("pt-BR")}</td>
                  <Cell cur={s.open_rate} prev={prev?.open_rate} metric="open_rate" />
                  <Cell cur={s.ctr} prev={prev?.ctr} metric="ctr" digits={2} />
                  <Cell cur={s.ctor} prev={prev?.ctor} metric="ctor" />
                  <Cell cur={s.bounce_rate} prev={prev?.bounce_rate} metric="bounce_rate" digits={2} />
                  <Cell cur={s.unsub_rate} prev={prev?.unsub_rate} metric="unsub_rate" digits={2} last />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Cell({ cur, prev, metric, digits = 1, last }: { cur: number; prev?: number; metric: MetricKey; digits?: number; last?: boolean }) {
  const diff = prev === undefined ? null : cur - prev;
  const rel = diff !== null && prev ? diff / prev : 0;
  const tone = diff === null ? "neutral" : deltaTone(metric, diff, rel);
  return (
    <td className={cn("py-3 text-right tabular-nums", last ? "px-6" : "px-3")}>
      <div className="text-[13px] font-medium">{fmtPct(cur, digits)}</div>
      {diff !== null && (
        <div className={cn("text-[11px]", tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-muted-foreground")}>
          {fmtDeltaPp(diff, digits)}
        </div>
      )}
    </td>
  );
}
