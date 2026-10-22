import { useMemo } from "react";
import { ArrowDownRight, CheckCircle2, CircleHelp } from "lucide-react";
import { Panel, Tag } from "@/components/app/ui-kit";
import { fmtInt } from "@/lib/hyperflow/metrics";
import { HISTORICAL_HUMAN_IMPACT as HISTORY, analyzeHistoricalHumanImpact } from "@/lib/hyperflow/human-impact";
import { useAtendimento } from "./store";

function percentage(n: number, d: number) {
  return d > 0 ? (100 * n / d).toFixed(1).replace(".", ",") + "%" : "—";
}

function HistoricalBar({ label, share, caption }: { label: string; share: number; caption: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span><strong className="tabular-nums text-foreground">{percentage(share, 1)}</strong>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-label={label + ": " + percentage(share, 1)}>
        <div className="h-full rounded-full bg-[#193469]" style={{ width: (share * 100) + "%" }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

export function HumanImpactPanel() {
  const { dataset, config } = useAtendimento();
  const audit = useMemo(
    () => analyzeHistoricalHumanImpact(dataset.chats, config.botNames, dataset.completeness === "complete"),
    [dataset.chats, dataset.completeness, config.botNames],
  );

  const before = HISTORY.before;
  const after = HISTORY.after;
  const pctReduction = (1 - after.human / before.human) * 100;
  const pp = (after.human / after.eligible - before.human / before.eligible) * 100;
  const currentComparisonAvailable = audit.eligibleForComparison;

  return (
    <section aria-label="Evolução do atendimento humano" className="mb-7">
      <Panel
        title="Evolução do atendimento humano"
        description="Estudo observacional · contatos receptivos do WhatsApp · 19 dias antes e depois da implantação da Duda"
        actions={<Tag tone="warn">Histórico preliminar</Tag>}
      >
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Protocolos com mensagem humana</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
              {fmtInt(before.human)} <span className="text-base font-normal text-muted-foreground">→</span> {fmtInt(after.human)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">12–30/set vs. 01–19/out de 2026</p>
            <p className="mt-1 text-xs text-muted-foreground">{fmtInt(before.eligible)} contatos receptivos válidos em cada janela</p>
          </div>
          <div className="rounded-xl bg-primary/5 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Variação de protocolos com humano</p>
            <div className="mt-1 flex items-center gap-2 text-primary">
              <ArrowDownRight className="h-6 w-6 shrink-0" />
              <strong className="text-3xl font-semibold tabular-nums">−{pctReduction.toFixed(1).replace(".", ",")}%</strong>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">33 protocolos a menos · queda observada, não causalidade comprovada</p>
          </div>
          <div>
            <p className="mb-3 text-xs font-medium text-muted-foreground">Participação humana na demanda receptiva</p>
            <div className="space-y-3">
              <HistoricalBar label="Antes" share={before.human / before.eligible} caption={percentage(before.human, before.eligible) + " dos contatos"} />
              <HistoricalBar label="Depois" share={after.human / after.eligible} caption={percentage(after.human, after.eligible) + " dos contatos"} />
            </div>
            <p className="mt-2 text-xs font-medium text-primary">{pp.toFixed(1).replace(".", ",")} pontos percentuais</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-start gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1 leading-relaxed">
            Estudo de 20/10/2026: exclui campanhas, conversas iniciadas pela equipe e testes; conta mensagens efetivamente registradas por agentes humanos, não simples atribuições. Em outubro, {HISTORY.openOrPending} protocolos estavam abertos ou pendentes. A redução é preliminar e não comprova resolução por IA.
          </p>
        </div>

        <details className="mt-4 rounded-lg border border-border bg-surface/50 px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-primary">Conferir cálculo na base sincronizada</summary>
          {currentComparisonAvailable ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-success" /> Os dois períodos foram recuperados com registros completos de mensagem e base elegível reconciliada.</p>
              <p className="tabular-nums text-foreground">
                Recalculado: {fmtInt(audit.before.human)} → {fmtInt(audit.after.human)} protocolos com mensagem humana.
                Variação: {audit.deltaRate == null ? "—" : (audit.deltaRate * 100).toFixed(1).replace(".", ",") + "%"}.
              </p>
              <p className="text-xs text-muted-foreground">O valor do estudo acima é preservado para comparação. Dados de hoje podem mudar com a conclusão de atendimentos pendentes.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Ainda não é possível recalcular o estudo automaticamente com segurança.</p>
              <p>
                Base atual (12–30/set → 01–19/out): {fmtInt(audit.before.eligible)} → {fmtInt(audit.after.eligible)} protocolos receptivos elegíveis;
                { " " }{fmtInt(audit.before.unknown)} → {fmtInt(audit.after.unknown)} com evidência de mensagem humana insuficiente.
              </p>
              <p>
                {!audit.isComplete
                  ? "Carregue os dois períodos completos na aba Dados e integrações."
                  : !audit.reconcilesStudy
                    ? "Os totais elegíveis diferem dos 277/277 da auditoria original. Revise filtros de testes, conversas iniciadas pela equipe, campanhas e canais antes de comparar."
                    : "Os campos de interações por agente precisam incluir systemInteractions para distinguir mensagem humana de simples atribuição."}
              </p>
              <p>O resultado de −16,9% acima é uma referência histórica, não um cálculo atualizado do painel.</p>
            </div>
          )}
        </details>
      </Panel>
    </section>
  );
}
