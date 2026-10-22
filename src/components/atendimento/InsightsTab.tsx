import type { ReactNode } from "react";
import { AlertTriangle, Eye, FlaskConical, Target } from "lucide-react";
import { Notice, Panel } from "@/components/app/ui-kit";
import type { InsightItem } from "@/lib/hyperflow/metrics";
import { useDerived } from "./shared";
import { useAtendimento } from "./store";

function Column({ icon, title, hint, items, empty }: { icon: ReactNode; title: string; hint: string; items: InsightItem[]; empty: string }) {
  return (
    <Panel>
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-4">
          {items.map((it, i) => (
            <li key={i} className="text-sm leading-relaxed">
              <span className="font-medium text-foreground">{it.text}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{it.evidence}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function InsightsTab() {
  const { kpis } = useAtendimento();
  const { insights } = useDerived();

  if (kpis.chats === 0) return <Notice>Nenhum atendimento no filtro atual.</Notice>;

  return (
    <div className="space-y-6">
      <Notice tone="info">
        Esta área separa três coisas. <strong>Fatos</strong> saem direto dos números. <strong>Hipóteses</strong> são explicações possíveis que precisam de confirmação. <strong>Recomendações</strong> só aparecem quando os dados sustentam. Nada aqui é preenchido sem amostra suficiente.
      </Notice>

      {insights.pending.length > 0 && (
        <Column
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
          title="Limites dos dados"
          hint="O que impede uma leitura mais firme. Resolver estes pontos melhora todas as análises."
          items={insights.pending}
          empty=""
        />
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Column icon={<Eye className="h-4 w-4 text-primary" />} title="O que os dados mostram" hint="Fatos observados no período filtrado." items={insights.facts} empty="Sem fatos relevantes para este filtro." />
        <Column icon={<FlaskConical className="h-4 w-4 text-primary" />} title="O que pode explicar" hint="Hipóteses. Valide lendo conversas reais ou perguntando à área." items={insights.hypotheses} empty="Nenhuma hipótese tem amostra suficiente (mínimo de 10 atendimentos por comparação)." />
        <Column icon={<Target className="h-4 w-4 text-primary" />} title="O que fazer" hint="Ações sugeridas, cada uma ligada a uma evidência." items={insights.recommendations} empty="Nenhuma recomendação se sustenta com os dados atuais." />
      </div>
    </div>
  );
}
