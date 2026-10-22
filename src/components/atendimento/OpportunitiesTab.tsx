import { Target, AlertCircle } from "lucide-react";
import { Notice, Panel } from "@/components/app/ui-kit";
import { fmtInt, fmtPct } from "@/lib/hyperflow/metrics";
import { useDerived } from "./shared";
import { useAtendimento } from "./store";
import { BotTab } from "./BotTab";
import { ReasonsTab } from "./ReasonsTab";
import { EfficiencyTab } from "./EfficiencyTab";
import { InsightsTab } from "./InsightsTab";

export function OpportunitiesTab() {
  const { kpis } = useAtendimento();
  const d = useDerived();
  const classified = d.reasons.classified;
  const top = [...d.reasons.stats].sort((a, b) => b.transferred - a.transferred || b.n - a.n).slice(0, 6);
  const hasMapping = kpis.duda + kpis.transferred > 0;
  if (kpis.chats === 0) return <Notice>Nenhum atendimento no filtro atual.</Notice>;
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-foreground">Onde podemos reduzir a necessidade de atendimento humano?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Identifique motivos recorrentes e fluxos que merecem revisão. Os números por agente são sinais operacionais, não prova de mensagens enviadas.</p>
      </header>
      {!hasMapping && <Notice tone="warn">A Hyperflow não retornou nomes ou tipos suficientes para reconhecer Duda ou Ada nesse período. Agentes sem identificação permanecem fora das estatísticas de IA e humano.</Notice>}
      <Panel title="Assuntos prioritários para investigar" description={`Cobertura de classificação: ${fmtInt(classified)} de ${fmtInt(kpis.chats)} atendimentos. Ordenação por participação de IA e humano no histórico, não por resolução efetiva.`}>
        {classified === 0 ? (
          <p className="text-sm text-muted-foreground">Ainda não há classificações suficientes para apontar motivos. Confira o campo de classificação na Hyperflow.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-3 pr-3 text-left font-medium">Motivo</th>
                <th className="px-3 py-3 text-right font-medium">Volume</th>
                <th className="px-3 py-3 text-right font-medium">IA + humano*</th>
                <th className="pl-3 py-3 text-right font-medium">Taxa**</th>
              </tr></thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.name} className="border-b border-border last:border-0">
                    <td className="py-3 pr-3 font-medium text-foreground">{r.name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.n)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{hasMapping ? fmtInt(r.transferred) : "—"}</td>
                    <td className="pl-3 py-3 text-right tabular-nums">{!hasMapping ? "—" : r.dudaTouched >= 10 ? fmtPct(r.transferRate) : "Amostra pequena"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">*IA e agente humano registrados no mesmo atendimento, conforme identificação automática. **Entre atendimentos com IA identificada; mínimo de 10 para exibir a taxa. Essas informações não comprovam mensagens humanas nem resolução.</p>
          </div>
        )}
      </Panel>

      <Panel>
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Próximas decisões para CRM e operação</h3>
        </div>
        {d.insights.recommendations.length > 0 ? (
          <ul className="space-y-3">
            {d.insights.recommendations.slice(0, 4).map((item, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium text-foreground">{item.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.evidence}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0" /> Ainda não há evidência suficiente para recomendar uma mudança. Confira a cobertura das classificações antes de priorizar.
          </p>
        )}
      </Panel>

      <details className="rounded-xl border border-border bg-card px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold text-primary">Explorar motivos, evolução e departamentos</summary>
        <div className="mt-6"><ReasonsTab /></div>
      </details>
      <details className="rounded-xl border border-border bg-card px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold text-primary">Ver desempenho detalhado dos assistentes de IA</summary>
        <div className="mt-6"><BotTab /></div>
      </details>
      <details className="rounded-xl border border-border bg-card px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold text-primary">Ver tempos, eficiência e análises avançadas</summary>
        <div className="mt-6 space-y-8"><EfficiencyTab /><InsightsTab /></div>
      </details>
    </div>
  );
}
