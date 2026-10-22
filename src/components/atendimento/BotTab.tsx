import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Notice, Panel, Tag } from "@/components/app/ui-kit";
import { fmtInt, fmtPct } from "@/lib/hyperflow/metrics";
import { cn } from "@/lib/utils";
import { KpiTile, SectionTitle, useDerived } from "./shared";
import { useAtendimento } from "./store";

const AXIS = { fontSize: 11, fill: "#5f6f8a" };
const TIP = { borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 };
const MIN_N = 10;

function splitTerms(s: string): string[] {
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

export function BotTab() {
  const { kpis, config, setConfig, scoped, dataset } = useAtendimento();
  const d = useDerived();
  const [bots, setBots] = useState(config.botNames.join(", "));
  const [markers, setMarkers] = useState(config.resolvedMarkers.join(", "));
  const agentNames = useMemo(() => [...new Set(dataset.chats.flatMap((chat) => chat.agentsAll))].sort((a, b) => a.localeCompare(b, "pt-BR")), [dataset.chats]);
  const toggleBot = (name: string, checked: boolean) => setBots((previous) => {
    const current = splitTerms(previous);
    return (checked ? [...new Set([...current, name])] : current.filter((x) => x !== name)).join(", ");
  });

  const byDept = useMemo(() => {
    const m = new Map<string, { touched: number; transferred: number }>();
    for (const r of scoped.operational) {
      if (!r.dept || !r.botTouched) continue;
      const x = m.get(r.dept) ?? { touched: 0, transferred: 0 };
      x.touched++;
      if (r.handling === "transferido") x.transferred++;
      m.set(r.dept, x);
    }
    return [...m.entries()].map(([dept, x]) => ({ dept, ...x, rate: x.touched ? x.transferred / x.touched : 0 })).sort((a, b) => b.transferred - a.transferred);
  }, [scoped.operational]);

  const reasons = d.reasons.stats.filter((r) => r.transferred > 0).sort((a, b) => b.transferred - a.transferred).slice(0, 10);
  const touched = kpis.duda + kpis.transferred;
  const res = d.resolution;
  const chart = d.series.map((p) => ({
    label: p.label,
    "Somente IA": p.duda,
    "IA e humano": p.transferred,
    "Humano direto": p.humanDirect,
    "Taxa de transferência (%)": p.transferRate == null ? null : Number((p.transferRate * 100).toFixed(1)),
  }));

  if (kpis.chats === 0) return <Notice>Nenhum atendimento no filtro atual.</Notice>;

  return (
    <div className="space-y-8">
      {kpis.coverage < 0.8 && (
        <Notice>
          Só {fmtPct(kpis.coverage, 0)} dos atendimentos trazem agente no histórico. A separação entre IA e humano depende de cadastrar todos os nomes das IAs e vale só para esses; os outros {fmtInt(kpis.indeterminate)} aparecem como "não identificado".
        </Notice>
      )}
      {touched === 0 && (
        <Notice tone="bad">
          Nenhuma das IAs cadastradas foi encontrada no histórico. Confira os nomes de agentes abaixo e selecione todos os assistentes virtuais.
        </Notice>
      )}

      <section>
        <SectionTitle title="Desempenho das IAs" hint="Considera só atendimentos em que o histórico permite saber quem atendeu." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="Somente IA" hint="Histórico com uma IA como único agente. Não é o mesmo que resolvido: o cliente pode ter desistido." value={fmtInt(kpis.duda)} sub={kpis.automationRate != null ? `${fmtPct(kpis.automationRate)} dos identificáveis` : undefined} />
          <KpiTile label="Transferidos para humano" hint="Uma IA participou e um agente humano assumiu o atendimento." value={fmtInt(kpis.transferred)} sub={`de ${fmtInt(touched)} em que uma IA participou`} />
          <KpiTile label="Taxa de transferência" hint="Transferidos ÷ atendimentos em que uma IA participou (somente IA + transferidos)." value={fmtPct(kpis.transferRate)} />
          {config.resolvedMarkers.length > 0 ? (
            <KpiTile
              label="Resolução automatizada comprovada"
              hint="Atendimentos só das IAs que carregam o rótulo ou classificação configurado como prova de resolução ÷ todos os atendimentos só das IAs."
              value={fmtPct(res.rate)}
              sub={`${fmtInt(res.proven)} de ${fmtInt(res.dudaOnly)}`}
            />
          ) : (
            <KpiTile
              label="Resolução automatizada"
              hint="Só é calculada quando existe um rótulo ou classificação que comprove a resolução. Atendimento sem humano não é, por si só, atendimento resolvido."
              value="Não comprovável"
              sub={`${fmtInt(res.closedWithoutHuman)} encerrados sem humano (não prova resolução)`}
            />
          )}
        </div>
      </section>

      <Panel title="Como uma IA e a resolução são identificadas" description="Configurações de análise, guardadas só neste navegador. Dados de clientes não são guardados.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome da automação nos agentes (separe por vírgula)</span>
            <input value={bots} onChange={(e) => setBots(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Rótulo ou classificação que prova resolução peluma IA</span>
            <input value={markers} onChange={(e) => setMarkers(e.target.value)} placeholder="Ex.: Resolvido peluma IA" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-surface/50 p-4">
          <p className="mb-1 text-sm font-medium text-foreground">Quais agentes são assistentes de IA?</p>
          <p className="mb-3 text-xs text-muted-foreground">Marque todos os assistentes virtuais encontrados nos dados. Agentes não cadastrados como IA serão classificados como humanos; isso pode distorcer os indicadores.</p>
          {agentNames.length === 0 ? (
            <p className="text-xs text-muted-foreground">Não há nomes de agentes disponíveis no histórico.</p>
          ) : (
            <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {agentNames.map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground">
                  <input type="checkbox" className="h-4 w-4 accent-[#0660FE]" checked={splitTerms(bots).includes(name)} onChange={(e) => toggleBot(name, e.target.checked)} />
                  <span className="truncate" title={name}>{name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4">
          <Button size="sm" onClick={() => setConfig({ botNames: splitTerms(bots), resolvedMarkers: splitTerms(markers) })}>
            Aplicar
          </Button>
        </div>
      </Panel>

      <Panel title="Evolução" description="Barras: atendimentos por quem atendeu. Linha: taxa de transferência das IAs.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis yAxisId="n" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis yAxisId="p" orientation="right" tick={AXIS} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={TIP} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="n" dataKey="Somente IA" stackId="a" fill="#0B3A8C" />
              <Bar yAxisId="n" dataKey="IA e humano" stackId="a" fill="#2F6BE0" />
              <Bar yAxisId="n" dataKey="Humano direto" stackId="a" fill="#8DB4F0" />
              <Line yAxisId="p" type="monotone" dataKey="Taxa de transferência (%)" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Assuntos em que uma IA precisou de apoio" description="Classificações dos atendimentos transferidos. A taxa só é confiável com 10 ou mais atendimentos." flush>
          {reasons.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">Nenhum atendimento transferido tem classificação neste filtro, então não dá para dizer o assunto.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Classificação</th>
                  <th className="px-3 py-3 text-right font-medium">Transferidos</th>
                  <th className="px-6 py-3 text-right font-medium">Taxa</th>
                </tr>
              </thead>
              <tbody>
                {reasons.map((r) => (
                  <tr key={r.name} className="border-t border-border">
                    <td className="px-6 py-3 text-[13px] font-medium">{r.name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.transferred)}</td>
                    <td className={cn("px-6 py-3 text-right tabular-nums", r.dudaTouched < MIN_N && "text-muted-foreground")}>
                      {fmtPct(r.transferRate)} {r.dudaTouched < MIN_N && <Tag tone="neutral" className="ml-1">poucos dados</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Transferências por departamento" description="Atendimentos em que uma IA participou, por departamento final." flush>
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Departamento</th>
                <th className="px-3 py-3 text-right font-medium">Com uma IA</th>
                <th className="px-3 py-3 text-right font-medium">Transferidos</th>
                <th className="px-6 py-3 text-right font-medium">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {byDept.map((x) => (
                <tr key={x.dept} className="border-t border-border">
                  <td className="px-6 py-3 text-[13px] font-medium">{x.dept}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtInt(x.touched)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtInt(x.transferred)}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{fmtPct(x.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
    </div>
  );
}
