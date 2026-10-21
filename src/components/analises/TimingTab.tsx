import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Loader2, Play } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getOpenTiming, type Campaign } from "@/lib/ac.functions";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, Panel, Stat } from "@/components/app/ui-kit";
import { cn } from "@/lib/utils";
import { fmtPct, toSendMetrics, type SendMetrics } from "@/lib/analysis/series";
import { bestWindow, BLOCKS, buildSendGrid, shareOf, WEEKDAYS, type GridCell } from "@/lib/analysis/timing";

const OPEN_SAMPLE = 8; // recent sends whose opens are read to build the hour curve

export function TimingTab({ campaigns }: { campaigns: Campaign[] }) {
  const fetchTiming = useServerFn(getOpenTiming);

  const sends = useMemo(
    () => campaigns.map(toSendMetrics).filter((s): s is SendMetrics => s !== null).sort((a, b) => b.date.localeCompare(a.date)),
    [campaigns],
  );
  const grid = useMemo(() => buildSendGrid(sends), [sends]);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timing, setTiming] = useState<{ hours: number[]; weekdays: number[]; total: number; failed: number; sends: number } | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      // Large sends only: tiny ones add noise to the hour curve.
      const ids = sends.filter((s) => s.sent >= 500).slice(0, OPEN_SAMPLE).map((s) => s.id);
      const res = await fetchTiming({ data: { ids } });
      setTiming({ ...res, sends: ids.length });
    } catch (e: any) {
      setError(e?.message ?? "Não consegui ler as aberturas no ActiveCampaign.");
    } finally {
      setRunning(false);
    }
  }

  if (sends.length < 5) {
    return <EmptyState icon={Clock} title="Ainda há poucos envios" description="Preciso de pelo menos 5 envios para olhar dia e horário." />;
  }

  const hourShare = timing ? shareOf(timing.hours) : [];
  const dowShare = timing ? shareOf(timing.weekdays) : [];
  const win = timing ? bestWindow(timing.hours, 3) : null;
  const topDow = timing ? timing.weekdays.indexOf(Math.max(...timing.weekdays)) : -1;

  return (
    <div className="space-y-6">
      <Panel
        title="Quando o público realmente abre"
        description={`Lê a hora exata da primeira abertura de cada contato nos ${OPEN_SAMPLE} maiores envios recentes. Mostra quando a atenção acontece, independente de quando você disparou.`}
        actions={
          <Button onClick={run} disabled={running} className="h-9">
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? "Lendo aberturas…" : timing ? "Atualizar" : "Rodar análise"}
          </Button>
        }
      >
        {error && <Notice tone="bad">{error}</Notice>}
        {!timing && !error && <p className="text-sm text-muted-foreground">Clique em "Rodar análise" para ler as aberturas no ActiveCampaign.</p>}
        {timing && timing.total === 0 && <Notice>Não encontrei aberturas com horário nesses envios.</Notice>}
        {timing && timing.total > 0 && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Aberturas lidas" value={timing.total.toLocaleString("pt-BR")} sub={`${timing.sends} envios`} />
              {win && (
                <Stat
                  label="Melhor janela de 3 horas"
                  value={`${String(win.from).padStart(2, "0")}h–${String(win.to).padStart(2, "0")}h`}
                  sub={`${win.share.toFixed(0)}% de todas as aberturas`}
                />
              )}
              {topDow >= 0 && <Stat label="Dia com mais aberturas" value={WEEKDAYS[topDow]} sub={`${dowShare[topDow].toFixed(0)}% das aberturas`} />}
            </div>
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">Aberturas por hora do dia (%)</h3>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourShare.map((v, h) => ({ hora: `${h}h`, v: Number(v.toFixed(1)) }))} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
                      <XAxis dataKey="hora" tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} interval={1} />
                      <YAxis tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v) => [`${v}%`, "Aberturas"]} contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
                      <Bar dataKey="v" fill="#0660FE" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">Aberturas por dia da semana (%)</h3>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dowShare.map((v, d) => ({ dia: WEEKDAYS[d], v: Number(v.toFixed(1)) }))} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
                      <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v) => [`${v}%`, "Aberturas"]} contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
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
        title="Desempenho por dia e período de envio"
        description="Resultado médio (ponderado por volume) dos envios feitos em cada combinação. O número pequeno é a quantidade de envios: células com poucos envios não provam nada."
      >
        <SendGrid grid={grid} />
      </Panel>
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
                          <span className="text-[13px] font-semibold tabular-nums text-foreground">CTR {fmtPct(cell.ctr, 2)}</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            abert. {fmtPct(cell.open_rate)} · {cell.n} {cell.n === 1 ? "envio" : "envios"}
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
