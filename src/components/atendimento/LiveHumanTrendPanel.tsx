import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Panel, Tag } from "@/components/app/ui-kit";
import { fmtInt } from "@/lib/hyperflow/metrics";
import { calculateLiveHumanTrend } from "@/lib/hyperflow/live-human-trend";
import { useAtendimento } from "./store";

const fmt = (v: number) => Math.abs(v).toFixed(1).replace(".", ",") + "%";
const fdate = (s: string) => s.split("-").reverse().join("/");

export function LiveHumanTrendPanel() {
  const { dataset, config } = useAtendimento();
  const trend = useMemo(
    () => calculateLiveHumanTrend(dataset, config.botNames),
    [dataset, config.botNames],
  );
  // Do not put historical or incompletely classified percentages on a KPI panel.
  // The missing-data diagnosis is available in Dados e auditoria.
  if (!trend.ready || trend.changePercent == null || trend.participationChangePp == null) return null;

  const delta = trend.changePercent;
  const Icon = delta < 0 ? ArrowDownRight : delta > 0 ? ArrowUpRight : Minus;
  return (
    <Panel
      title="Evolução do atendimento humano"
      description="Últimos 30 dias completos vs. os 30 dias anteriores · contatos receptivos WhatsApp"
      actions={<Tag tone="good">Calculado pela Hyperflow</Tag>}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Protocolos com mensagem humana</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
            {fmtInt(trend.before.withHumanMessage)} <span className="text-base font-normal text-muted-foreground">→</span> {fmtInt(trend.current.withHumanMessage)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Janelas consecutivas de 30 dias</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Variação do atendimento humano</p>
          <p className="mt-2 flex items-center gap-2 text-3xl font-semibold tabular-nums text-foreground">
            <Icon className="h-6 w-6" />
            {delta < 0 ? "−" : delta > 0 ? "+" : ""}{fmt(delta)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Variação observada entre os períodos; não prova causalidade da IA</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Participação humana nos contatos</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {fmt(trend.before.withHumanMessage / trend.before.eligible * 100)}
            <span className="mx-1 text-base font-normal text-muted-foreground">→</span>
            {fmt(trend.current.withHumanMessage / trend.current.eligible * 100)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {trend.participationChangePp > 0 ? "+" : trend.participationChangePp < 0 ? "−" : ""}
            {Math.abs(trend.participationChangePp).toFixed(1).replace(".", ",")} p.p.
          </p>
        </div>
      </div>
      <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
        {fdate(trend.before.start)} a {fdate(trend.before.end)} vs. {fdate(trend.current.start)} a {fdate(trend.current.end)}
        {" · "}Base atualizada em {trend.updatedAt?.toLocaleString("pt-BR") ?? "—"}.
        Em próximas sincronizações, a comparação avança automaticamente.
      </p>
    </Panel>
  );
}
