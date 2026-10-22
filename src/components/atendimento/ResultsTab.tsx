import { useMemo } from "react";
import { Notice } from "@/components/app/ui-kit";
import { fmtDelta, fmtInt, fmtPct, pctChange } from "@/lib/hyperflow/metrics";
import { messageEvidence } from "@/lib/hyperflow/human-impact";
import { KpiTile } from "./shared";
import { useAtendimento } from "./store";
import { LiveHumanTrendPanel } from "./LiveHumanTrendPanel";
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
      <LiveHumanTrendPanel />

      <section>
        <h2 className="mb-1 text-base font-semibold text-foreground">Atendimento no período selecionado</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {filters.start.toLocaleDateString("pt-BR")} a {filters.end.toLocaleDateString("pt-BR")} · visão operacional filtrada.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Atendimentos únicos"
            hint="Protocolos únicos registrados no período e nos filtros selecionados; não são mensagens."
            value={fmtInt(kpis.chats)}
            deltaText={volumeChange == null ? undefined : fmtDelta(volumeChange)}
            sub={volumeChange == null ? "Sem período anterior completo para comparação" : "Comparação com período anterior de igual duração"}
          />
          {complete && observed.unknown === 0 && (
            <KpiTile
              label="Com mensagem humana"
              hint="Atendimentos com mensagem enviada por agente humano comprovada nos contadores por interação. Sem supor que um agente atribuído enviou mensagem."
              value={fmtInt(observed.human)}
              sub="Todos os registros deste filtro têm evidência"
            />
          )}
          <KpiTile
            label="Com IA identificada"
            hint="Conversas em que Duda ou Ada foram identificadas automaticamente. Participação no histórico não comprova resolução."
            value={fmtInt(kpis.duda + kpis.transferred)}
            sub={fmtPct((kpis.duda + kpis.transferred) / kpis.chats) + " dos atendimentos"}
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
        Os indicadores são recalculados com a base da última sincronização. Dados insuficientes para medir intervenção humana aparecem em Dados e auditoria, não como percentuais na visão principal.
      </p>

      <details className="rounded-xl border border-border bg-card px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold text-primary">Ver gráficos, evolução do volume e indicadores operacionais</summary>
        <div className="mt-6"><ExecutiveTab /></div>
      </details>
    </div>
  );
}
