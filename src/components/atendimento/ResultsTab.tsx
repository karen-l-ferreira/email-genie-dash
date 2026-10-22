import { useMemo } from "react";
import { Notice, Panel } from "@/components/app/ui-kit";
import { fmtDelta, fmtInt, fmtPct, pctChange } from "@/lib/hyperflow/metrics";
import { messageEvidence } from "@/lib/hyperflow/human-impact";
import { KpiTile } from "./shared";
import { useAtendimento } from "./store";
import { HumanImpactPanel } from "./HumanImpactPanel";
import { ExecutiveTab } from "./ExecutiveTab";

export function ResultsTab() {
  const { scoped, kpis, config, dataset, prev, filters } = useAtendimento();
  const observed = useMemo(() => {
    let human = 0, unknown = 0;
    for (const r of scoped.operational) {
      const evidence = messageEvidence(r, config.botNames);
      if (evidence === "human") human++;
      else if (evidence === "unknown") unknown++;
    }
    return { human, unknown };
  }, [scoped.operational, config.botNames]);
  const volumeChange = prev.covered && prev.kpis.chats > 0 ? pctChange(kpis.chats, prev.kpis.chats) : null;
  const transferred = scoped.operational.filter((r) => r.transfers > 0).length;
  const classified = scoped.operational.filter((r) => r.classifications.length > 0).length;
  const complete = dataset.completeness === "complete";

  if (kpis.chats === 0) return <Notice>Nenhum atendimento no período selecionado. Ajuste os filtros ou sincronize os dados.</Notice>;

  return (
    <div className="space-y-6">
      <HumanImpactPanel />

      <section>
        <h2 className="mb-1 text-base font-semibold text-foreground">Atendimento no período selecionado</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {filters.start.toLocaleDateString("pt-BR")} a {filters.end.toLocaleDateString("pt-BR")} · os números abaixo não são a mesma base do estudo histórico.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Atendimentos únicos"
            hint="Protocolos únicos registrados no período e nos filtros selecionados; não são mensagens."
            value={fmtInt(kpis.chats)}
            deltaText={volumeChange == null ? undefined : fmtDelta(volumeChange)}
            sub={volumeChange == null ? "Sem período anterior completo para comparação" : "Comparação com período anterior de igual duração"}
          />
          <KpiTile
            label="Com mensagem humana"
            hint="Somente contadores positivos de mensagens atribuídas a agente humano. Se faltar qualquer evidência, o total não é conclusivo."
            value={!complete || observed.unknown > 0 ? "—" : fmtInt(observed.human)}
            sub={observed.unknown > 0 ? `${fmtInt(observed.unknown)} protocolos sem evidência suficiente` : !complete ? "Extração não verificada" : "Mensagem comprovada; não apenas agente atribuído"}
          />
          <KpiTile
            label="Com encaminhamento"
            hint="Protocolos com pelo menos um transferAt registrado; não significa que houve mensagem humana."
            value={fmtInt(transferred)}
            sub={fmtPct(transferred / kpis.chats) + " dos atendimentos"}
          />
          <KpiTile
            label="Motivos classificados"
            hint="Atendimentos com ao menos uma classificação no Hyperflow; uma conversa pode ter várias."
            value={fmtPct(classified / kpis.chats)}
            sub={`${fmtInt(classified)} de ${fmtInt(kpis.chats)} atendimentos`}
          />
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        A redução no atendimento humano só é considerada confirmada após a auditoria por protocolo. Encaminhamento e atribuição de agente não comprovam atendimento realizado ou resolução pela IA.
      </p>

      <details className="rounded-xl border border-border bg-card px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold text-primary">Ver gráficos, evolução do volume e indicadores operacionais</summary>
        <div className="mt-6"><ExecutiveTab /></div>
      </details>
    </div>
  );
}
