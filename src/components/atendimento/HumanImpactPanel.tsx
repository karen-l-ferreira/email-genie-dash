import { useMemo, useState, type ChangeEvent } from "react";
import { CheckCircle2, FileJson, Info, AlertTriangle } from "lucide-react";
import { Notice, Panel, Tag } from "@/components/app/ui-kit";
import { fmtInt } from "@/lib/hyperflow/metrics";
import { parseAuditBaseline, reconcileAudit, type AuditBaseline } from "@/lib/hyperflow/audit-reconcile";
import { useAtendimento } from "./store";

function formatPct(value: number | null): string {
  return value == null ? "—" : value.toFixed(1).replace(".", ",") + "%";
}

function AuditStep({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
        {label}
      </div>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function HumanImpactPanel() {
  const { dataset, config } = useAtendimento();
  const [baseline, setBaseline] = useState<AuditBaseline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analysis = useMemo(
    () => baseline ? reconcileAudit(baseline, dataset.chats, config.botNames, dataset.completeness === "complete") : null,
    [baseline, dataset.chats, dataset.completeness, config.botNames],
  );
  async function loadAudit(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 3_000_000) throw new Error("Arquivo acima do limite de 3 MB.");
      const parsed = parseAuditBaseline(await file.text());
      setBaseline(parsed);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível validar a auditoria.");
      setBaseline(null);
    } finally {
      e.target.value = "";
    }
  }

  const evidenceUnknown = analysis ? analysis.before.noMessageEvidence + analysis.after.noMessageEvidence : 0;
  const open = analysis ? analysis.before.stillOpen + analysis.after.stillOpen : 0;
  const matches = analysis ? analysis.before.matched + analysis.after.matched : 0;
  const missing = analysis ? analysis.before.absent + analysis.after.absent : 0;
  const unknownStatus = analysis ? analysis.before.statusUnknown + analysis.after.statusUnknown : 0;
  const final = analysis?.final ?? false;

  return (
    <section aria-label="Redução de atendimento humano" className="mb-7">
      <Panel
        title="Redução de atendimento humano"
        description="Comparação de 19 dias: 12–30/set x 01–19/out · somente protocolos receptivos válidos"
        actions={<Tag tone={final ? "good" : "warn"}>{final ? "Resultado validado" : "Aguardando validação"}</Tag>}
      >
        {final && analysis ? (
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-primary/5 p-5">
              <p className="text-xs font-medium text-muted-foreground">Redução confirmada de protocolos com mensagem humana</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{formatPct(analysis.reductionPercent)}</p>
              <p className="mt-2 text-xs text-muted-foreground">Comparação de dois períodos equivalentes; não comprova causalidade das IAs.</p>
            </div>
            <div className="rounded-xl border border-border p-5">
              <p className="text-xs text-muted-foreground">Protocolos com mensagem humana</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtInt(analysis.before.humanNow)} → {fmtInt(analysis.after.humanNow)}</p>
              <p className="mt-2 text-xs text-muted-foreground">Antes → depois</p>
            </div>
            <div className="rounded-xl border border-border p-5">
              <p className="text-xs text-muted-foreground">Participação humana</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatPct(analysis.humanShareBefore == null ? null : analysis.humanShareBefore * 100)}
                {" → "}
                {formatPct(analysis.humanShareAfter == null ? null : analysis.humanShareAfter * 100)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{analysis.deltaParticipationPp?.toFixed(1).replace(".", ",")} p.p.</p>
            </div>
          </div>
        ) : (
          <Notice tone="warn">
            <strong className="text-foreground">Ainda não existe um percentual definitivo.</strong>{" "}
            O estudo anterior tem uma divergência de dois protocolos e havia 51 atendimentos pendentes.
            O valor só será liberado após conferir a auditoria por protocolo contra a extração atual.
          </Notice>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface/50 p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">1. Carregar auditoria original</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Utilize o JSON de conferência da planilha de 1.380 protocolos. O arquivo fica somente na memória desta aba, sem upload para servidor.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted">
            <FileJson className="h-4 w-4" />
            {baseline ? "Trocar auditoria" : "Selecionar auditoria JSON"}
            <input type="file" className="sr-only" accept=".json,application/json" onChange={(e) => void loadAudit(e)} />
          </label>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
        {baseline && analysis && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AuditStep label="Base receptiva auditada" ok={analysis.baseMatched} value={`${fmtInt(analysis.before.eligible)} / ${fmtInt(analysis.after.eligible)}`} />
              <AuditStep label="Protocolos localizados na API" ok={missing === 0 && analysis.duplicateProtocols === 0} value={`${fmtInt(matches)} de 554`} />
              <AuditStep label="Mensagens ainda sem evidência" ok={evidenceUnknown === 0} value={fmtInt(evidenceUnknown)} />
              <AuditStep label="Protocolos ainda em aberto" ok={open === 0 && missing === 0} value={fmtInt(open)} />
            </div>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              <p><strong className="text-foreground">Pendentes na auditoria de 20/10:</strong> {fmtInt(analysis.after.originalPending)}. Desses, {fmtInt(analysis.after.originalPendingClosed)} estão com status não aberto na extração atual.</p>
              <p><strong className="text-foreground">Mensagens humanas novas comprovadas:</strong> {fmtInt(analysis.before.newHumanSinceSnapshot)} no período anterior e {fmtInt(analysis.after.newHumanSinceSnapshot)} no posterior.</p>
              {missing > 0 && <p className="text-warning">Faltam {fmtInt(missing)} protocolos auditados na extração. Sincronize desde 12/09 até 19/10 (ou depois).</p>}
              {!analysis.complete && <p className="text-warning">A extração atual precisa estar completa para esses períodos. Não é possível calcular uma redução definitiva com registros ausentes.</p>}
              {evidenceUnknown > 0 && <p className="text-warning">Os {fmtInt(evidenceUnknown)} protocolos sem confirmação precisam dos contadores de mensagens por interação da Hyperflow.</p>}
              {open > 0 && <p className="text-warning">Ainda há {fmtInt(open)} protocolos em andamento, que podem receber atendimento humano.</p>}
              {unknownStatus > 0 && <p className="text-warning">{fmtInt(unknownStatus)} protocolos não têm status válido na API; precisam ser confirmados antes do resultado final.</p>}
              {analysis.duplicateProtocols > 0 && <p className="text-warning">Foram encontrados {fmtInt(analysis.duplicateProtocols)} protocolos duplicados na extração. É necessário revisar a base.</p>}
            </div>
          </>
        )}

        <details className="mt-5 border-t border-border pt-4">
          <summary className="cursor-pointer text-xs font-semibold text-primary">Conferir histórico de 20/10 e metodologia</summary>
          <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>Na planilha detalhada, houve 277 contatos receptivos válidos em cada período: 195 com mensagem humana em setembro e 164 em outubro (queda observada de 15,9%).</p>
            <p>Outro relatório apresentava 162 em outubro (−16,9%). Os dois protocolos de diferença ainda não foram reconciliados e, por isso, nenhum desses resultados será exibido como definitivo.</p>
            <p>A auditoria exclui testes, campanhas e contatos iniciados pela equipe. Uma atribuição de agente não comprova mensagem humana. A ausência de mensagem humana também não comprova resolução pela IA.</p>
            <p className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" />Uma queda comprovada entre períodos não prova que toda a diferença foi causada pelas automações.</p>
          </div>
        </details>
      </Panel>
    </section>
  );
}
