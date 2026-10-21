import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getOpenTiming, type Campaign } from "@/lib/ac.functions";
import { Advice, EmptyState, Explainer, Notice, Panel, Stat } from "@/components/app/ui-kit";
import { cn } from "@/lib/utils";
import { fmtPct, toSendMetrics, type SendMetrics } from "@/lib/analysis/series";
import { bestWindow, BLOCKS, buildSendGrid, shareOf, WEEKDAYS, type GridCell } from "@/lib/analysis/timing";

const OPEN_SAMPLE = 8; // recent sends whose opens are read to build the hour curve
const WEEKDAY_FULL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const hh = (h: number) => `${String(h).padStart(2, "0")}h`;

export function TimingTab({ campaigns }: { campaigns: Campaign[] }) {
  const fetchTiming = useServerFn(getOpenTiming);

  const sends = useMemo(
    () => campaigns.map(toSendMetrics).filter((s): s is SendMetrics => s !== null).sort((a, b) => b.date.localeCompare(a.date)),
    [campaigns],
  );
  const grid = useMemo(() => buildSendGrid(sends), [sends]);
  const ids = useMemo(() => sends.filter((s) => s.sent >= 500).slice(0, OPEN_SAMPLE).map((s) => s.id), [sends]);

  // Runs by itself and is cached, so coming back to the tab is instant.
  const q = useQuery({
    queryKey: ["open-timing", ids.join(",")],
    enabled: ids.length >= 2,
    retry: false,
    staleTime: 30 * 60 * 1000,
    queryFn: () => fetchTiming({ data: { ids } }),
  });

  const timing = q.data;
  const hourShare = timing ? shareOf(timing.hours) : [];
  const dowShare = timing ? shareOf(timing.weekdays) : [];
  const win = timing ? bestWindow(timing.hours, 3) : null;
  const topDow = timing ? timing.weekdays.indexOf(Math.max(...timing.weekdays)) : -1;

  return (
    <div>
      <Explainer>
        Responde duas perguntas: <strong>a que horas e em que dia seu público realmente abre os e-mails</strong>, e <strong>em que dia e período vale mais a pena disparar</strong>. Use para
        escolher o melhor momento do próximo envio. A leitura começa sozinha.
      </Explainer>

      {sends.length < 5 ? (
        <EmptyState icon={Clock} title="Ainda há poucos envios" description="Preciso de pelo menos 5 envios para olhar dia e horário." />
      ) : (
        <div className="space-y-6">
          <Panel
            title="Quando seu público abre os e-mails"
            description={`Leio a hora da primeira abertura de cada pessoa nos ${ids.length} maiores envios recentes. Mostra quando a atenção acontece, não quando você enviou.`}
          >
            {q.isFetching && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lendo as aberturas no ActiveCampaign…
              </p>
            )}
            {q.isError && <Notice tone="bad">{(q.error as Error).message}</Notice>}
            {timing && timing.total === 0 && <Notice>Não encontrei aberturas com horário nesses envios.</Notice>}
            {timing && timing.total > 0 && (
              <div className="space-y-6">
                <div>
                  <p className="text-base leading-relaxed text-foreground">
                    {win && (
                      <>
                        Seu público abre mais entre <strong className="font-semibold">{hh(win.from)} e {hh(win.to)}</strong> ({win.share.toFixed(0)}% de todas as aberturas)
                      </>
                    )}
                    {topDow >= 0 && (
                      <>
                        , e o dia mais forte é <strong className="font-semibold">{WEEKDAY_FULL[topDow]}</strong> ({dowShare[topDow].toFixed(0)}%)
                      </>
                    )}
                    .
                  </p>
                  {win && (
                    <div className="mt-3">
                      <Advice tone="good">
                        envie um pouco antes das {hh(win.from)} para o e-mail já estar no topo da caixa de entrada quando as pessoas abrirem.
                      </Advice>
                    </div>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Stat label="Aberturas lidas" value={timing.total.toLocaleString("pt-BR")} sub={`em ${ids.length} envios`} />
                  {win && <Stat label="Melhor janela de 3 horas" value={`${hh(win.from)}–${hh(win.to)}`} sub={`${win.share.toFixed(0)}% das aberturas`} />}
                  {topDow >= 0 && <Stat label="Dia com mais aberturas" value={WEEKDAYS[topDow]} sub={`${dowShare[topDow].toFixed(0)}% das aberturas`} />}
                </div>
                <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                  <div>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">De cada 100 aberturas, quantas acontecem em cada hora</h3>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={hourShare.map((v, h) => ({ hora: `${h}h`, v: Number(v.toFixed(1)) }))} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
                          <XAxis dataKey="hora" tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} interval={1} />
                          <YAxis tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
                          <Tooltip formatter={(v) => [`${v}%`, "Das aberturas"]} contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
                          <Bar dataKey="v" fill="#0660FE" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">E em cada dia da semana</h3>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dowShare.map((v, d) => ({ dia: WEEKDAYS[d], v: Number(v.toFixed(1)) }))} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
                          <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
                          <Tooltip formatter={(v) => [`${v}%`, "Das aberturas"]} contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
                          <Bar dataKey="v" fill="#16a34a" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
                {timing.failed > 0 && <Notice>{timing.failed} envio(s) não puderam ser lidos.</Notice>}
              </div>
            )}
          </Panel>

          <Panel
            title="Em que dia e período vale mais a pena disparar"
            description="Cada quadrado reúne os envios feitos naquele dia e período. Quanto mais azul, mais gente clicou. O texto menor mostra quantos envios entraram na conta: quadrados com 1 ou 2 envios não provam nada."
          >
            <SendGrid grid={grid} />
          </Panel>
        </div>
      )}
    </div>
  );
}

function SendGrid({ grid }: { grid: GridCell[][] }) {
  const ctrs = grid.flat().filter((c) => c.n >= 2).map((c) => c.ctr);
  const max = Math.max(...ctrs, 0.0001);
  const min = Math.min(...ctrs, max);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="w-20 px-2 py-2 text-left font-medium" />
            {BLOCKS.map((b) => (
              <th key={b.key} className="px-2 py-2 text-center font-medium">
                {b.label}
                <div className="text-[10px] font-normal text-muted-foreground/70">{b.range}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, dow) => (
            <tr key={dow}>
              <td className="px-2 py-1 text-xs font-medium text-muted-foreground">{WEEKDAYS[dow]}</td>
              {row.map((cell, b) => {
                const reliable = cell.n >= 2;
                const t = reliable && max > min ? (cell.ctr - min) / (max - min) : 0;
                return (
                  <td key={b} className="p-1">
                    <div
                      className={cn("flex h-14 flex-col items-center justify-center rounded-lg text-center", cell.n === 0 ? "bg-surface/60" : "")}
                      style={cell.n > 0 ? { backgroundColor: `rgba(6, 96, 254, ${reliable ? 0.08 + t * 0.4 : 0.04})` } : undefined}
                    >
                      {cell.n > 0 ? (
                        <>
                          <span className="text-[13px] font-semibold tabular-nums text-foreground">{fmtPct(cell.ctr, 2)} clicaram</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {fmtPct(cell.open_rate)} abriram · {cell.n} {cell.n === 1 ? "envio" : "envios"}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">·</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
