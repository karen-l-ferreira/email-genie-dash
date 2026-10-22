import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Notice, Panel } from "@/components/app/ui-kit";
import { fmtDelta, fmtInt, fmtPct, pctChange } from "@/lib/hyperflow/metrics";
import { cn } from "@/lib/utils";
import { DEPT_COLORS, KpiTile, SectionTitle, useDerived } from "./shared";
import { useAtendimento } from "./store";

const AXIS = { fontSize: 11, fill: "#5f6f8a" };
const TIP = { borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 };

// Percentage-point change between two rates (0–1).
function pp(cur: number | null, prev: number | null): number | null {
  return cur != null && prev != null ? (cur - prev) * 100 : null;
}
function fmtPp(v: number | null): string | undefined {
  return v == null ? undefined : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1).replace(".", ",")} p.p.`;
}

export function ExecutiveTab() {
  const { kpis, prev, filters, scoped } = useAtendimento();
  const d = useDerived();
  const base = prev.covered && prev.kpis.chats > 0 ? prev.kpis : null;

  const vol = base ? pctChange(kpis.chats, base.chats) : null;
  const auto = base ? pp(kpis.automationRate, base.automationRate) : null;
  const trf = base ? pp(kpis.transferRate, base.transferRate) : null;
  const hum = base ? pp(kpis.humanShare, base.humanShare) : null;

  if (kpis.chats === 0) {
    return <Notice>Nenhum atendimento no filtro atual. Ajuste o período ou os departamentos.</Notice>;
  }

  const handlingBar = [
    { key: "duda", label: "Somente IA", n: kpis.duda, color: "#0B3A8C", hint: "Apenas assistentes de IA cadastrados aparecem como agentes. Isso não comprova resolução." },
    { key: "trf", label: "IA e humano", n: kpis.transferred, color: "#2F6BE0", hint: "Assistente de IA identificado junto com agente humano." },
    { key: "hum", label: "Humano direto", n: kpis.humanDirect, color: "#8DB4F0", hint: "Agentes não cadastrados como IA foram tratados como humanos; confira a lista de assistentes na aba de IA." },
    { key: "ind", label: "Não identificado", n: kpis.indeterminate, color: "#CBD5E1", hint: "O histórico não traz nenhum agente, então não dá para saber." },
  ];

  return (
    <div className="space-y-8">
      {!base && (
        <Notice>
          {prev.covered
            ? "Não há atendimentos no período anterior para comparar."
            : "Os dados carregados não cobrem todo o período anterior, então as variações ficam ocultas. Sincronize ou importe um intervalo maior."}
        </Notice>
      )}

      <section>
        <SectionTitle
          title="Indicadores do período"
          hint={`${filters.start.toLocaleDateString("pt-BR")} a ${filters.end.toLocaleDateString("pt-BR")}${base ? ` · variação frente a ${prev.range.start.toLocaleDateString("pt-BR")} a ${prev.range.end.toLocaleDateString("pt-BR")}` : ""}`}
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiTile
            label="Atendimentos únicos"
            hint="Conversas distintas pelo _id, no período e nos departamentos selecionados. Uma conversa conta uma vez, não importa quantas mensagens ou transferências teve."
            value={fmtInt(kpis.chats)}
            deltaText={vol != null ? fmtDelta(vol) : undefined}
            sub={base ? `${fmtInt(base.chats)} no período anterior` : undefined}
          />
          <KpiTile
            label="Mensagens"
            hint="Soma de messagesCount dos atendimentos acima. Mensagens são outra unidade: um atendimento tem várias."
            value={kpis.messagesMissing === kpis.chats ? "—" : fmtInt(kpis.messages)}
            sub={kpis.messagesMissing > 0 ? `${fmtInt(kpis.messagesMissing)} atendimentos sem esse campo` : `${(kpis.messages / kpis.chats).toFixed(1).replace(".", ",")} por atendimento`}
          />
          <KpiTile
            label="Interações"
            hint="Quantidade de passagens registradas no histórico (interactions) dos atendimentos: cada vez que o atendimento passou por um agente ou departamento. Não são mensagens."
            value={fmtInt(kpis.interactions)}
            sub={`${fmtInt(kpis.transfers)} encaminhamentos registrados`}
          />
          <KpiTile
            label="Com intervenção humana"
            hint="Atendimentos com um agente não cadastrado como IA. Confira todos os nomes de IA antes de interpretar como intervenção humana."
            value={fmtInt(kpis.human)}
            deltaText={fmtPp(hum)}
            sub={kpis.humanShare != null ? `${fmtPct(kpis.humanShare)} dos identificáveis` : "sem histórico de agentes"}
          />
          <KpiTile
            label="Taxa de automação validada"
            hint="Atendimentos exclusivamente de IAs cadastradas ÷ atendimentos com agente identificável. Confira os nomes de IA na configuração. Não representa resolução."
            value={fmtPct(kpis.automationRate)}
            deltaText={fmtPp(auto)}
            tone={auto == null ? "neutral" : auto >= 0 ? "good" : "bad"}
            sub={`base: ${fmtPct(kpis.coverage, 0)} dos atendimentos identificáveis`}
          />
          <KpiTile
            label="Taxa de transferência das IAs"
            hint="Atendimentos com IA e humano ÷ todos em que as IAs cadastradas participaram."
            value={fmtPct(kpis.transferRate)}
            deltaText={fmtPp(trf)}
            tone={trf == null ? "neutral" : trf <= 0 ? "good" : "bad"}
            sub={`${fmtInt(kpis.transferred)} de ${fmtInt(kpis.duda + kpis.transferred)}`}
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Panel title="Evolução do volume">
          <VolumeChart />
        </Panel>
        <Panel title="Participação por departamento" description="Parcela do volume e variação frente ao período anterior.">
          <ul className="space-y-4">
            {d.deptCur.map((x, i) => {
              const p = d.deptPrev?.find((y) => y.dept === x.dept);
              const ch = p ? pctChange(x.n, p.n) : null;
              return (
                <li key={x.dept}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{x.dept}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtInt(x.n)} · {fmtPct(x.share)}
                      {ch != null && <span className={cn("ml-2 text-xs font-medium", ch >= 0 ? "text-foreground" : "text-muted-foreground")}>{fmtDelta(ch)}</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${x.share * 100}%`, backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </section>

      <section>
        <SectionTitle title="Quem atendeu" hint="Somente IA, IA e humano, humano direto ou não identificado, de acordo com os nomes de assistentes cadastrados." />
        <Panel>
          <div className="flex h-4 overflow-hidden rounded-full bg-muted">
            {handlingBar.filter((b) => b.n > 0).map((b) => (
              <div key={b.key} title={`${b.label}: ${fmtInt(b.n)}`} style={{ width: `${(b.n / kpis.chats) * 100}%`, backgroundColor: b.color }} />
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {handlingBar.map((b) => (
              <div key={b.key}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
                  {b.label}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{fmtInt(b.n)}</div>
                <div className="text-xs text-muted-foreground">{fmtPct(b.n / kpis.chats)} · {b.hint}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section>
        <SectionTitle title="Principais movimentos" hint="Só fatos que os números sustentam. Hipóteses e recomendações estão na aba Inteligência." />
        <Panel>
          <ul className="space-y-3">
            {d.insights.facts.slice(0, 6).map((f, i) => (
              <li key={i} className="text-sm leading-relaxed">
                <span className="font-medium text-foreground">{f.text}</span>
                <span className="block text-xs text-muted-foreground">{f.evidence}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      {scoped.campaigns.length > 0 && !filters.includeCampaigns && (
        <Notice tone="info">
          {fmtInt(scoped.campaigns.length)} atendimentos de campanha (broadcast) no período ficaram fora destes indicadores. Marque "Incluir campanhas" para somá-los.
        </Notice>
      )}
    </div>
  );
}

function VolumeChart() {
  const { filters, granularity } = useAtendimento();
  const d = useDerived();
  const data = d.series.map((p) => ({ label: p.label, ...p.byDept }));
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Atendimentos únicos por {granularity === "week" ? "semana" : "dia"} e departamento.
      </p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TIP} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            {filters.departments.map((name, i) => (
              <Area key={name} type="monotone" dataKey={name} stackId="1" stroke={DEPT_COLORS[i % DEPT_COLORS.length]} fill={DEPT_COLORS[i % DEPT_COLORS.length]} fillOpacity={0.85} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
