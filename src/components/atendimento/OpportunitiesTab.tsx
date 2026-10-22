import { useEffect, useMemo, useState } from "react";
import { Target, AlertCircle } from "lucide-react";
import { Notice, Panel } from "@/components/app/ui-kit";
import { fmtInt, fmtPct } from "@/lib/hyperflow/metrics";
import { useDerived } from "./shared";
import { useAtendimento } from "./store";
import { BotTab } from "./BotTab";
import { ReasonsTab } from "./ReasonsTab";
import { EfficiencyTab } from "./EfficiencyTab";
import { InsightsTab } from "./InsightsTab";

function AssistantSettings() {
  const { config, setConfig, dataset } = useAtendimento();
  const [names, setNames] = useState(config.botNames.join(", "));
  useEffect(() => setNames(config.botNames.join(", ")), [config.botNames]);
  const available = useMemo(
    () => [...new Set(dataset.chats.flatMap((r) => r.agentsAll))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [dataset.chats],
  );
  const parsed = names.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
  const toggle = (name: string, checked: boolean) => setNames((current) => {
    const list = current.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    return (checked ? [...new Set([...list, name])] : list.filter((v) => v !== name)).join(", ");
  });
  return (
    <details className="rounded-xl border border-border bg-card px-5 py-4">
      <summary className="cursor-pointer text-sm font-semibold text-primary">Identificar assistentes de IA (Duda, Ada e outros)</summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs text-muted-foreground">Cadastre todos os nomes dos assistentes virtuais. Um nome não cadastrado pode ser confundido com agente humano. Nenhuma seleção altera dados na Hyperflow.</p>
        <label className="block text-xs font-medium text-muted-foreground">
          Nomes das IAs, separados por vírgula
          <input value={names} onChange={(e) => setNames(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
        </label>
        {available.length > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Marcar entre os agentes encontrados:</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {available.map((name) => (
                <label key={name} className="flex items-center gap-2 text-xs text-foreground">
                  <input type="checkbox" checked={parsed.includes(name)} onChange={(e) => toggle(name, e.target.checked)} className="accent-[#0660FE]" />
                  <span className="truncate" title={name}>{name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <button type="button" onClick={() => setConfig({ botNames: parsed })}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          Salvar identificação das IAs
        </button>
      </div>
    </details>
  );
}

export function OpportunitiesTab() {
  const { kpis, config, dataset } = useAtendimento();
  const d = useDerived();
  const classified = d.reasons.classified;
  const top = [...d.reasons.stats].sort((a, b) => b.transferred - a.transferred || b.n - a.n).slice(0, 6);
  const hasMapping = dataset.chats.some((r) => r.agentsAll.some((a) => config.botNames.some((b) => a.toLowerCase() === b.toLowerCase())));
  if (kpis.chats === 0) return <Notice>Nenhum atendimento no filtro atual.</Notice>;
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-foreground">Onde podemos reduzir a necessidade de atendimento humano?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Identifique motivos recorrentes e fluxos que merecem revisão. Os números por agente são sinais operacionais, não prova de mensagens enviadas.</p>
      </header>
      <AssistantSettings />
      {!hasMapping && <Notice tone="warn">Nenhum nome configurado de IA foi localizado nos agentes. Confira a identificação das IAs acima antes de interpretar os encaminhamentos.</Notice>}
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
                    <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.transferred)}</td>
                    <td className="pl-3 py-3 text-right tabular-nums">{r.dudaTouched >= 10 ? fmtPct(r.transferRate) : "Amostra pequena"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">*IA e agente humano registrados no mesmo atendimento, conforme nomes configurados. **Entre atendimentos com IA identificada; mínimo de 10 para exibir a taxa. Essas informações não comprovam mensagens humanas nem resolução.</p>
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
            <AlertCircle className="h-4 w-4 shrink-0" /> Ainda não há evidência suficiente para recomendar uma mudança. Confira os motivos e a identificação das IAs antes de priorizar.
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
