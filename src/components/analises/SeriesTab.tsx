import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, ClipboardCopy, Search } from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Campaign } from "@/lib/ac.functions";
import { Input } from "@/components/ui/input";
import { Advice, EmptyState, Explainer, Notice, Panel, Segmented, Stat, Tag, type Tone } from "@/components/app/ui-kit";
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
  sentenceFor,
  seriesByKeyword,
  VERDICT,
  type MetricKey,
  type SendMetrics,
  type SeriesAssessment,
} from "@/lib/analysis/series";

type Window = "30" | "90" | "all";

export function SeriesTab({ campaigns }: { campaigns: Campaign[] }) {
  const allSeries = useMemo(() => buildSeries(campaigns), [campaigns]);
  const assessments = useMemo(() => assessAll(allSeries), [allSeries]);

  const [windowKey, setWindowKey] = useState<Window>("90");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const visible = useMemo(() => {
    if (windowKey === "all") return assessments;
    const since = subDays(new Date(), Number(windowKey));
    return assessments.filter((a) => parseSendDate(a.latest.date) >= since);
  }, [assessments, windowKey]);

  const worse = visible.filter((a) => a.severity === "critical" || a.severity === "warning");
  const better = visible.filter((a) => a.severity === "positive");
  const normal = visible.filter((a) => a.severity === "ok" || a.severity === "insufficient");
  const attention = [...worse, ...better];

  const keywordSends = useMemo(() => (keyword.trim() ? seriesByKeyword(campaigns, keyword) : []), [campaigns, keyword]);

  return (
    <div>
      <Explainer>
        Alguns disparos saem sempre (a newsletter, por exemplo). Esta tela compara cada edição com as anteriores <strong>do mesmo disparo</strong> e mostra só o que
        ficou diferente do normal, para você saber o que olhar primeiro. Não precisa escolher nada.
      </Explainer>

      {allSeries.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Ainda não achei disparos recorrentes"
          description="Preciso de pelo menos 2 envios com o mesmo nome (por exemplo, 'Newsletter #1' e 'Newsletter #2')."
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base leading-relaxed text-foreground">
              {visible.length === 0 ? (
                "Nenhum disparo recorrente teve envio neste período."
              ) : (
                <>
                  De <strong className="font-semibold">{visible.length}</strong> disparos recorrentes:{" "}
                  <strong className="font-semibold text-success">{better.length} melhoraram</strong>,{" "}
                  <strong className="font-semibold text-destructive">{worse.length} pioraram</strong> e {normal.length} estão normais.
                  {worse.length > 0 && " Comece pelos que pioraram."}
                </>
              )}
            </p>
            <Segmented<Window>
              size="sm"
              value={windowKey}
              onChange={setWindowKey}
              options={[
                { value: "30", label: "Últimos 30 dias" },
                { value: "90", label: "90 dias" },
                { value: "all", label: "Tudo" },
              ]}
            />
          </div>

          {attention.length > 0 && (
            <div className="space-y-3">
              {attention.map((a) => (
                <SeriesCard key={a.series.key} a={a} open={openKey === a.series.key} onToggle={() => setOpenKey(openKey === a.series.key ? null : a.series.key)} />
              ))}
            </div>
          )}

          {normal.length > 0 && (
            <Panel title={`Dentro do normal (${normal.length})`} description="Nada de diferente nestes disparos. Abra se quiser conferir o histórico." flush>
              <ul className="divide-y divide-border">
                {normal.map((a) => (
                  <li key={a.series.key}>
                    <SeriesRow a={a} open={openKey === a.series.key} onToggle={() => setOpenKey(openKey === a.series.key ? null : a.series.key)} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Procurar outro disparo" description="Digite uma palavra do nome (por exemplo, churn) para ver todos os envios que a contêm.">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Palavra no nome do disparo" className="h-9 pl-9" />
            </div>
            {keyword.trim() && (
              <div className="mt-5">
                <Detail title={`Envios com "${keyword.trim()}"`} sends={keywordSends} />
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function adviceFor(a: SeriesAssessment): string {
  return a.comparison?.diagnosis[0] ?? "";
}

function SeriesCard({ a, open, onToggle }: { a: SeriesAssessment; open: boolean; onToggle: () => void }) {
  const v = VERDICT[a.severity];
  const c = a.comparison;
  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-foreground">{a.series.label}</h3>
          <Tag tone={v.tone as Tone}>{v.label}</Tag>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Último envio em {format(parseSendDate(a.latest.date), "d 'de' MMMM", { locale: ptBR })} para {a.latest.sent.toLocaleString("pt-BR")} contatos
        </p>
        {c && <p className="mt-3 text-sm leading-relaxed text-foreground">{sentenceFor(c)}</p>}
        {c && (
          <div className="mt-3">
            <Advice tone={v.tone as Tone}>{adviceFor(a)}</Advice>
          </div>
        )}
        <button type="button" onClick={onToggle} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {open ? "Esconder detalhes" : "Ver detalhes"}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-surface/40 p-5">
          <Detail title={a.series.label} sends={a.series.sends} />
        </div>
      )}
    </div>
  );
}

function SeriesRow({ a, open, onToggle }: { a: SeriesAssessment; open: boolean; onToggle: () => void }) {
  const c = a.comparison;
  return (
    <>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-4 px-6 py-3.5 text-left transition-colors hover:bg-surface">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{a.series.label}</div>
          <div className="text-xs text-muted-foreground">
            {a.series.sends.length} edições · último em {format(parseSendDate(a.latest.date), "d 'de' MMM", { locale: ptBR })}
          </div>
        </div>
        {c && (
          <div className="hidden text-right text-xs text-muted-foreground sm:block">
            abriram <strong className="font-medium text-foreground">{fmtPct(a.latest.open_rate)}</strong> · clicaram{" "}
            <strong className="font-medium text-foreground">{fmtPct(a.latest.ctr, 2)}</strong>
          </div>
        )}
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border bg-surface/40 p-5">
          <Detail title={a.series.label} sends={a.series.sends} />
        </div>
      )}
    </>
  );
}

function deltaTone(metric: MetricKey, abs: number, rel: number): Tone {
  if (Math.abs(rel) < 0.05) return "neutral";
  const better = HIGHER_IS_BETTER[metric] ? abs > 0 : abs < 0;
  return better ? "good" : "bad";
}

function Detail({ title, sends }: { title: string; sends: SendMetrics[] }) {
  const cmp = useMemo(() => compareLatest(sends), [sends]);

  if (!cmp) {
    return <p className="text-sm text-muted-foreground">Só encontrei {sends.length} envio(s). Preciso de pelo menos 2 para comparar.</p>;
  }

  const metrics: MetricKey[] = ["open_rate", "ctr", "ctor"];
  const small: MetricKey[] = ["bounce_rate", "unsub_rate"];
  const digits = (m: MetricKey) => (m === "ctr" || m === "bounce_rate" || m === "unsub_rate" ? 2 : 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Último envio comparado com a média dos {cmp.baselineCount} anteriores (envios maiores pesam mais na média).
        </p>
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
        {metrics.map((m) => (
          <Stat
            key={m}
            label={METRIC_LABEL[m]}
            value={fmtPct(cmp.latest[m], digits(m))}
            delta={`${fmtDeltaPp(cmp.delta[m].abs, digits(m))} (${fmtRel(cmp.delta[m].rel)})`}
            tone={deltaTone(m, cmp.delta[m].abs, cmp.delta[m].rel)}
            sub={`normal: ${fmtPct(cmp.baseline[m], digits(m))}`}
          />
        ))}
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {metrics.map((m) => (
          <li key={m}>
            <strong className="font-medium text-foreground">{METRIC_LABEL[m]}:</strong> {METRIC_HELP[m]}.
          </li>
        ))}
        <li>
          p.p. = pontos percentuais. Se foi de 10% para 12%, são +2 p.p.
        </li>
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        {small.map((m) => (
          <Stat
            key={m}
            label={METRIC_LABEL[m]}
            value={fmtPct(cmp.latest[m], 2)}
            delta={`${fmtDeltaPp(cmp.delta[m].abs, 2)}`}
            tone={deltaTone(m, cmp.delta[m].abs, cmp.delta[m].rel)}
            sub={`normal: ${fmtPct(cmp.baseline[m], 2)} · ${METRIC_HELP[m].toLowerCase()}`}
          />
        ))}
      </div>

      {cmp.warnings.length > 0 && (
        <div className="space-y-2">
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

      <TrendChart sends={sends} />
      <HistoryTable sends={sends} />
    </div>
  );
}

function TrendChart({ sends }: { sends: SendMetrics[] }) {
  const data = [...sends].reverse().map((s) => ({
    date: format(parseSendDate(s.date), "dd/MM"),
    "Abriram": Number(s.open_rate.toFixed(1)),
    "Clicaram": Number(s.ctr.toFixed(2)),
    "Clicaram entre quem abriu": Number(s.ctor.toFixed(1)),
  }));
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-3 text-sm font-medium">Como foi cada edição (%)</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} unit="%" />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Abriram" stroke="#0660FE" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Clicaram" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Clicaram entre quem abriu" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HistoryTable({ sends }: { sends: SendMetrics[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left font-medium">Edição</th>
            <th className="px-3 py-3 text-left font-medium">Data</th>
            <th className="px-3 py-3 text-right font-medium">Enviados</th>
            <th className="px-3 py-3 text-right font-medium">Abriram</th>
            <th className="px-3 py-3 text-right font-medium">Clicaram</th>
            <th className="px-3 py-3 text-right font-medium">Não chegaram</th>
            <th className="px-5 py-3 text-right font-medium">Descadastros</th>
          </tr>
        </thead>
        <tbody>
          {sends.map((s, i) => {
            const prev = sends[i + 1];
            return (
              <tr key={s.id} className="border-t border-border">
                <td className="max-w-[280px] truncate px-5 py-3 text-[13px] font-medium">{s.name}</td>
                <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">{format(parseSendDate(s.date), "dd/MM/yy")}</td>
                <td className="px-3 py-3 text-right tabular-nums">{s.sent.toLocaleString("pt-BR")}</td>
                <Cell cur={s.open_rate} prev={prev?.open_rate} metric="open_rate" />
                <Cell cur={s.ctr} prev={prev?.ctr} metric="ctr" digits={2} />
                <Cell cur={s.bounce_rate} prev={prev?.bounce_rate} metric="bounce_rate" digits={2} />
                <Cell cur={s.unsub_rate} prev={prev?.unsub_rate} metric="unsub_rate" digits={2} last />
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">O número pequeno embaixo compara com a edição anterior.</p>
    </div>
  );
}

function Cell({ cur, prev, metric, digits = 1, last }: { cur: number; prev?: number; metric: MetricKey; digits?: number; last?: boolean }) {
  const diff = prev === undefined ? null : cur - prev;
  const rel = diff !== null && prev ? diff / prev : 0;
  const tone = diff === null ? "neutral" : deltaTone(metric, diff, rel);
  return (
    <td className={cn("py-3 text-right tabular-nums", last ? "px-5" : "px-3")}>
      <div className="text-[13px] font-medium">{fmtPct(cur, digits)}</div>
      {diff !== null && (
        <div className={cn("text-[11px]", tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-muted-foreground")}>
          {fmtDeltaPp(diff, digits)}
        </div>
      )}
    </td>
  );
}
