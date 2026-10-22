import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Notice, Panel, Tag } from "@/components/app/ui-kit";
import {
  TO_SECONDS, byDept, dist, fmtDuration, fmtInt, fmtPct, peakWindow, type Dist, type TimeUnit,
} from "@/lib/hyperflow/metrics";
import { cn } from "@/lib/utils";
import { KpiTile, SectionTitle, useDerived } from "./shared";
import { useAtendimento } from "./store";

const AXIS = { fontSize: 11, fill: "#5f6f8a" };
const TIP = { borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 };
const UNIT_LABEL: Record<TimeUnit, string> = { s: "segundos", ms: "milissegundos", min: "minutos" };

export function EfficiencyTab() {
  const { kpis, scoped, config, setConfig, timeUnitSuggestion } = useAtendimento();
  const d = useDerived();
  const rows = scoped.operational;

  const wait = useMemo(() => dist(rows.map((r) => r.waitSec).filter((x): x is number => x != null)), [rows]);
  const duration = useMemo(() => dist(rows.map((r) => r.durationSec).filter((x): x is number => x != null)), [rows]);
  const durationByDept = useMemo(() => byDept(rows, (r) => r.durationSec, (v) => dist(v as number[])) as { dept: string; value: Dist | null }[], [rows]);

  // Raw time fields (queuedTime, user/system interaction time) only after the unit is confirmed.
  const unitFactor = config.timeUnit ? TO_SECONDS[config.timeUnit] : null;
  const rawStats = useMemo(() => {
    if (unitFactor == null) return null;
    const pick = (f: (r: (typeof rows)[number]) => number | null) => dist(rows.map(f).filter((x): x is number => x != null && x >= 0).map((x) => x * unitFactor));
    return { queued: pick((r) => r.queuedTime), user: pick((r) => r.userInteractionTime), system: pick((r) => r.systemInteractionTime) };
  }, [rows, unitFactor]);

  const peak = peakWindow(d.hourly, 3);
  const meanAsFinal = d.agents.length ? d.agents.reduce((s, a) => s + a.asFinal, 0) / d.agents.length : 0;
  const totalFinal = d.agents.reduce((s, a) => s + a.asFinal, 0);
  const top3 = d.agents.slice(0, 3).reduce((s, a) => s + a.asFinal, 0);
  const durCoverage = rows.length ? rows.filter((r) => r.durationSec != null).length / rows.length : 0;
  const waitCoverage = rows.length ? rows.filter((r) => r.waitSec != null).length / rows.length : 0;

  if (kpis.chats === 0) return <Notice>Nenhum atendimento no filtro atual.</Notice>;

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle title="Tempos" hint="Calculados pela diferença entre datas registradas, que têm unidade conhecida. Mediana e P90 resistem a casos extremos; a média pode enganar." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Espera até a 1ª interação (mediana)"
            hint="Diferença entre createdAt e firstInteractionAt. Se a Duda responde na hora, esse tempo pode refletir a resposta automática, não a espera por um humano."
            value={fmtDuration(wait?.median ?? null)}
            sub={wait ? `P90 ${fmtDuration(wait.p90)} · média ${fmtDuration(wait.mean)} · ${fmtPct(waitCoverage, 0)} com o dado` : "sem datas suficientes"}
          />
          <KpiTile
            label="Duração do atendimento (mediana)"
            hint="Diferença entre createdAt e finishedAt, só para atendimentos finalizados. Atendimentos em aberto ficam fora."
            value={fmtDuration(duration?.median ?? null)}
            sub={duration ? `P90 ${fmtDuration(duration.p90)} · ${fmtPct(durCoverage, 0)} finalizados` : "sem atendimentos finalizados"}
          />
          <KpiTile
            label="Com encaminhamento"
            hint="Atendimentos com pelo menos uma transferência registrada (transferAt) no histórico de interações."
            value={fmtInt(d.transfers.withTransfer)}
            sub={`${fmtPct(kpis.chats ? d.transfers.withTransfer / kpis.chats : 0)} do total`}
          />
          <KpiTile
            label="Encaminhados 2 vezes ou mais"
            hint="Atendimentos com duas ou mais transferências. Indica idas e vindas entre equipes."
            value={fmtInt(d.transfers.pingPong)}
            tone={d.transfers.pingPong > 0 ? "warn" : "neutral"}
            sub={`${fmtPct(kpis.chats ? d.transfers.pingPong / kpis.chats : 0)} do total`}
          />
        </div>
      </section>

      <Panel title="Campos de tempo da Hyperflow" description="queuedTime, userInteractionTime e systemInteractionTime vêm sem unidade documentada. Só calculo médias com eles depois que você confirmar a unidade.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {config.timeUnit ? (
            <>
              <Tag tone="good">unidade confirmada: {UNIT_LABEL[config.timeUnit]}</Tag>
              <Button variant="ghost" size="sm" onClick={() => setConfig({ timeUnit: null })}>
                Trocar
              </Button>
            </>
          ) : (
            <>
              <Tag tone="warn">não validada</Tag>
              {timeUnitSuggestion.unit ? (
                <span className="text-xs text-muted-foreground">
                  Pelos dados ({timeUnitSuggestion.samples} atendimentos comparados), parece ser <strong className="text-foreground">{UNIT_LABEL[timeUnitSuggestion.unit]}</strong>. É uma estimativa, não uma garantia.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {timeUnitSuggestion.samples < 20 ? "Poucos atendimentos têm os campos necessários para estimar." : "Os valores não permitem estimar com segurança."} Escolha a unidade se a documentação da Hyperflow confirmar.
                </span>
              )}
              <div className="flex gap-2">
                {(["s", "ms", "min"] as TimeUnit[]).map((u) => (
                  <Button key={u} size="sm" variant={timeUnitSuggestion.unit === u ? "default" : "outline"} onClick={() => setConfig({ timeUnit: u })}>
                    Confirmar {UNIT_LABEL[u]}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
        {rawStats && (
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <KpiTile label="Tempo em fila (queuedTime)" hint={`Mediana, considerando a unidade ${UNIT_LABEL[config.timeUnit!]}.`} value={fmtDuration(rawStats.queued?.median ?? null)} sub={rawStats.queued ? `P90 ${fmtDuration(rawStats.queued.p90)}` : "sem dados"} />
            <KpiTile label="Interação do cliente" hint="Mediana de userInteractionTime." value={fmtDuration(rawStats.user?.median ?? null)} sub={rawStats.user ? `P90 ${fmtDuration(rawStats.user.p90)}` : "sem dados"} />
            <KpiTile label="Interação do sistema" hint="Mediana de systemInteractionTime." value={fmtDuration(rawStats.system?.median ?? null)} sub={rawStats.system ? `P90 ${fmtDuration(rawStats.system.p90)}` : "sem dados"} />
          </div>
        )}
      </Panel>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Espera e duração por departamento" description="Mediana e P90. Departamentos com menos de 10 atendimentos medidos aparecem esmaecidos." flush>
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Departamento</th>
                <th className="px-3 py-3 text-right font-medium">Espera (mediana)</th>
                <th className="px-3 py-3 text-right font-medium">Espera (P90)</th>
                <th className="px-6 py-3 text-right font-medium">Duração (mediana)</th>
              </tr>
            </thead>
            <tbody>
              {d.wait.map((w) => {
                const dur = durationByDept.find((x) => x.dept === w.dept)?.value ?? null;
                return (
                  <tr key={w.dept} className={cn("border-t border-border", (w.value?.n ?? 0) < 10 && "opacity-60")}>
                    <td className="px-6 py-3 text-[13px] font-medium">{w.dept}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtDuration(w.value?.median ?? null)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtDuration(w.value?.p90 ?? null)}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{fmtDuration(dur?.median ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title="Encaminhamentos por departamento" description="Atendimentos com ao menos uma transferência." flush>
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Departamento</th>
                <th className="px-3 py-3 text-right font-medium">Atendimentos</th>
                <th className="px-3 py-3 text-right font-medium">Encaminhados</th>
                <th className="px-6 py-3 text-right font-medium">Parcela</th>
              </tr>
            </thead>
            <tbody>
              {d.transfers.perDept.map((x) => (
                <tr key={x.dept} className="border-t border-border">
                  <td className="px-6 py-3 text-[13px] font-medium">{x.dept}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtInt(x.chats)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtInt(x.withTransfer)}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{fmtPct(x.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <Panel title="Demanda por hora de entrada" description={peak ? `Maior concentração: ${peak.from}h a ${peak.to}h, com ${fmtPct(peak.share, 0)} dos atendimentos (horário do seu navegador).` : undefined}>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.hourly.map((n, h) => ({ hora: `${h}h`, Atendimentos: n }))} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
              <XAxis dataKey="hora" tick={AXIS} tickLine={false} axisLine={false} interval={1} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TIP} />
              <Bar dataKey="Atendimentos" fill="#0B3A8C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <section>
        <SectionTitle
          title="Carga dos agentes humanos"
          hint={`"Responsável" é o agente final do atendimento; "Participou" inclui quem atendeu em algum momento. ${totalFinal > 0 ? `Os 3 maiores concentram ${fmtPct(top3 / totalFinal, 0)} dos atendimentos com responsável.` : ""}`}
        />
        <Panel flush>
          {d.agents.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">Nenhum agente humano identificado neste filtro.</p>
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-xs text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">Agente</th>
                    <th className="px-3 py-3 text-right font-medium">Responsável</th>
                    <th className="px-3 py-3 text-right font-medium">Participou</th>
                    <th className="px-3 py-3 text-right font-medium">Mensagens</th>
                    <th className="px-6 py-3 text-right font-medium">Duração (mediana)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.agents.slice(0, 100).map((a) => (
                    <tr key={a.agent} className="border-t border-border">
                      <td className="px-6 py-3 text-[13px] font-medium">
                        {a.agent}
                        {meanAsFinal > 0 && a.asFinal >= meanAsFinal * 1.5 && d.agents.length >= 3 && <Tag tone="warn" className="ml-2">acima de 1,5x a média</Tag>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtInt(a.asFinal)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtInt(a.participated)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtInt(a.messages)}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{fmtDuration(a.medianDurationSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}
