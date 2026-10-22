import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Notice, Panel, Tag } from "@/components/app/ui-kit";
import { fmtInt, fmtPct } from "@/lib/hyperflow/metrics";
import { cn } from "@/lib/utils";
import { DEPT_COLORS, SectionTitle, useDerived } from "./shared";
import { useAtendimento } from "./store";

const AXIS = { fontSize: 11, fill: "#5f6f8a" };
const TIP = { borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 };
const MIN_N = 10;

export function ReasonsTab() {
  const { kpis, filters } = useAtendimento();
  const d = useDerived();
  const { stats, classified, unclassified } = d.reasons;
  const top = stats.slice(0, 12);
  const top5 = stats.slice(0, 5);

  const evolution = useMemo(
    () =>
      d.series.map((p) => ({
        label: p.label,
        ...Object.fromEntries(top5.map((r) => [r.name, r.series[p.key] ?? 0])),
      })),
    [d.series, top5],
  );

  if (kpis.chats === 0) return <Notice>Nenhum atendimento no filtro atual.</Notice>;

  if (classified === 0) {
    return (
      <Notice tone="bad">
        <p className="font-medium text-foreground">Não dá para identificar os motivos de contato com estes dados.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nenhum dos {fmtInt(kpis.chats)} atendimentos do filtro traz classificação (campo <code className="rounded bg-muted px-1">classifications.name</code>). Confira se o campo foi incluído na extração ou se a equipe classifica os atendimentos ao encerrar.
        </p>
      </Notice>
    );
  }

  return (
    <div className="space-y-8">
      <Notice tone={unclassified / kpis.chats > 0.3 ? "warn" : "info"}>
        {fmtInt(classified)} de {fmtInt(kpis.chats)} atendimentos ({fmtPct(classified / kpis.chats, 0)}) têm classificação; {fmtInt(unclassified)} ficaram sem. Um atendimento pode ter mais de uma classificação, então as porcentagens somam mais de 100%.
      </Notice>

      <Panel title="Assuntos mais frequentes" description="Atendimentos por classificação no período.">
        <div className="h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top.map((r) => ({ name: r.name, Atendimentos: r.n }))} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" horizontal={false} />
              <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={180} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TIP} />
              <Bar dataKey="Atendimentos" fill="#0B3A8C" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Evolução dos 5 principais assuntos" description="Quantidade de atendimentos por classificação ao longo do período.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={evolution} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TIP} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              {top5.map((r, i) => (
                <Line key={r.name} type="monotone" dataKey={r.name} stroke={["#0B3A8C", "#2F6BE0", "#16a34a", "#d97706", "#64748B"][i]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <section>
        <SectionTitle title="Por departamento e transferência" hint="Cada linha mostra quantos atendimentos do assunto vieram de cada departamento e quanto foi transferido da Duda para humano." />
        <Panel flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Classificação</th>
                  <th className="px-3 py-3 text-right font-medium">Total</th>
                  {filters.departments.map((dep, i) => (
                    <th key={dep} className="px-3 py-3 text-right font-medium">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                      {dep}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-medium">Transferidos</th>
                  <th className="px-6 py-3 text-right font-medium">Taxa de transferência</th>
                </tr>
              </thead>
              <tbody>
                {stats.slice(0, 20).map((r) => (
                  <tr key={r.name} className="border-t border-border">
                    <td className="px-6 py-3 text-[13px] font-medium">{r.name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.n)}</td>
                    {filters.departments.map((dep) => (
                      <td key={dep} className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {fmtInt(r.byDept[dep] ?? 0)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.transferred)}</td>
                    <td className={cn("px-6 py-3 text-right tabular-nums", r.dudaTouched < MIN_N && "text-muted-foreground")}>
                      {fmtPct(r.transferRate)} {r.transferRate != null && r.dudaTouched < MIN_N && <Tag tone="neutral" className="ml-1">poucos dados</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </div>
  );
}
