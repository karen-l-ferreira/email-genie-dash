import { useMemo, useState, type ChangeEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, FileJson } from "lucide-react";
import { Panel, Tag } from "@/components/app/ui-kit";
import { fmtInt } from "@/lib/hyperflow/metrics";
import { messageEvidence } from "@/lib/hyperflow/human-impact";
import { parseAuditBaseline, reconcileAudit } from "@/lib/hyperflow/audit-reconcile";
import { useAtendimento } from "./store";

const AUDIT_BEFORE = 195;
const AUDIT_AFTER = 164;
const AUDIT_DATE = "20/10/2026";
const OBSERVED_BASE = 277;

function pct(value: number): string {
  return value.toFixed(1).replace(".", ",") + "%";
}
function difference(before: number, after: number): string {
  if (before === 0) return "—";
  const v = ((after - before) / before) * 100;
  return (v < 0 ? "−" : v > 0 ? "+" : "") + pct(Math.abs(v));
}
function points(before: number, after: number, total: number): string {
  const delta = (after - before) * 100 / total;
  return (delta > 0 ? "+" : delta < 0 ? "−" : "") + Math.abs(delta).toFixed(1).replace(".", ",") + " p.p.";
}

export function HumanImpactPanel() {
  const { dataset, config, auditBaseline: baseline, setAuditBaseline: setBaseline } = useAtendimento();
  const [error, setError] = useState<string | null>(null);
  const audit = useMemo(
    () => baseline ? reconcileAudit(baseline, dataset.chats, config.botNames, dataset.completeness === "complete") : null,
    [baseline, dataset.chats, dataset.completeness, config.botNames],
  );

  const compared = audit?.complete === true;
  const before = compared ? audit.before.humanNow : AUDIT_BEFORE;
  const after = compared ? audit.after.humanNow : AUDIT_AFTER;
  const unknown = compared ? audit.unknownCases : 0;
  const isVerified = compared && audit.final;
  const pending = compared ? audit.after.stillOpen : null;
  const cutoff = compared && dataset.loadedAt
    ? dataset.loadedAt.toLocaleString("pt-BR")
    : AUDIT_DATE;
  const snapshotType = compared
    ? dataset.sources.some((s) => s.kind === "api") ? "Consulta API de" : "Dados importados em"
    : "Auditoria de";
  const isImprovement = after < before;

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 3_000_000) throw new Error("O arquivo de auditoria excede 3 MB.");
      setBaseline(parseAuditBaseline(await file.text()));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível conferir o arquivo.");
    } finally {
      e.target.value = "";
    }
  }

  function downloadPending() {
    if (!baseline || !audit) return;
    const current = new Map(dataset.chats.filter((c) => c.protocol).map((c) => [c.protocol!, c]));
    const lines = ["protocolo;periodo;motivo"];
    for (const r of baseline.records) {
      if (!r.eligible) continue;
      const chat = current.get(r.protocol);
      const reasons: string[] = [];
      if (!chat) reasons.push("ausente_na_extracao");
      else {
        if (messageEvidence(chat, config.botNames) === "unknown" && !r.humanMessage) reasons.push("sem_evidencia_de_mensagem");
        if (["active", "overdue", "hold", "queued"].includes((chat.status ?? "").toLowerCase())) reasons.push("ainda_aberto");
        if (!chat.status) reasons.push("status_ausente");
      }
      if (reasons.length) lines.push([r.protocol, r.period, reasons.join("|")].join(";"));
    }
    const blob = new Blob(["\uFEFF", lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fluxi_protocolos_conferir.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-label="Medição da participação humana" className="mb-7">
      <Panel
        title="Participação humana no atendimento"
        description="Comparação dos mesmos 19 dias: 12–30/set e 01–19/out · 277 contatos receptivos válidos em cada período"
        actions={<Tag tone={isVerified ? "good" : "neutral"}>{isVerified ? "Conferido na data de corte" : "Fotografia dos dados"}</Tag>}
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{snapshotType} <strong className="font-medium text-foreground">{cutoff}</strong></span>
          {compared && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-success" />554 de 554 protocolos localizados</span>}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground">Protocolos com mensagem humana comprovada</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{fmtInt(before)} <span className="text-base text-muted-foreground">→</span> {fmtInt(after)}</p>
            <p className="mt-2 text-xs text-muted-foreground">{compared ? "Mínimos comprovados até a última extração" : "Registro da auditoria original"}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground">{isVerified ? "Variação medida na data de corte" : "Diferença entre contagens comprovadas"}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{difference(before, after)}</p>
            <p className="mt-2 text-xs text-muted-foreground">{Math.abs(after - before)} protocolos {isImprovement ? "a menos" : after === before ? "de diferença" : "a mais"} com mensagem registrada</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground">Participação na demanda receptiva</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{pct(before * 100 / OBSERVED_BASE)} <span className="text-base text-muted-foreground">→</span> {pct(after * 100 / OBSERVED_BASE)}</p>
            <p className="mt-2 text-xs text-muted-foreground">{points(before, after, OBSERVED_BASE)} entre as contagens comprovadas</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-surface/50 px-4 py-3 text-sm leading-relaxed text-foreground">
          {compared ? (
            <>
              <strong>{isVerified ? "Leitura conferida no corte." : "Leitura com cobertura parcial de mensagens."}</strong>{" "}
              {isVerified
                ? "Todos os protocolos têm evidência suficiente para apurar presença ou ausência de mensagem humana nessa extração."
                : `Existem ${fmtInt(unknown)} protocolos sem dados suficientes para verificar novas mensagens humanas. Os números acima são mínimos documentados; a diferença não representa necessariamente a redução real de toda a operação.`}
              {pending != null && pending > 0 && ` ${fmtInt(pending)} protocolos de outubro ainda estavam abertos na consulta; eles não impedem medir a situação até essa data, mas podem mudar o resultado em consultas futuras.`}
            </>
          ) : (
            <>
              <strong>Base histórica em {AUDIT_DATE}.</strong> A planilha detalhada registra 195 → 164 (−15,9%).
              Para atualizar esta fotografia, importe a auditoria original e sincronize os protocolos na aba Dados e auditoria.
            </>
          )}
        </div>

        <details className="mt-4 rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-primary">Auditoria e informações técnicas</summary>
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs text-muted-foreground">Selecione o JSON de auditoria original. Os protocolos ficam só na memória desta aba e são comparados com a extração atual.</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">
                <FileJson className="h-4 w-4" />{baseline ? "Trocar auditoria" : "Carregar auditoria"}
                <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void onUpload(e)} />
              </label>
            </div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            {audit && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <p className="text-xs text-muted-foreground"><strong className="block text-lg tabular-nums text-foreground">{fmtInt(audit.before.matched + audit.after.matched)} / 554</strong>Protocolos encontrados</p>
                  <p className="text-xs text-muted-foreground"><strong className="block text-lg tabular-nums text-foreground">{fmtInt(audit.unknownCases)}</strong>Sem evidência suficiente</p>
                  <p className="text-xs text-muted-foreground"><strong className="block text-lg tabular-nums text-foreground">{fmtInt(audit.after.stillOpen)}</strong>Em aberto em outubro</p>
                </div>
                <p className="text-xs text-muted-foreground">Desde 20/10, novas mensagens humanas comprovadas: {fmtInt(audit.before.newHumanSinceSnapshot)} em setembro e {fmtInt(audit.after.newHumanSinceSnapshot)} em outubro. Casos sem evidência não são tratados como mensagens ausentes.</p>
                {(!audit.complete || audit.unknownCases > 0 || audit.before.statusUnknown + audit.after.statusUnknown > 0) && (
                  <p className="flex items-start gap-2 text-xs text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Para fechar a classificação de 100% da base, faltam registros íntegros por protocolo, incluindo contadores de mensagens por agente. A API pode não fornecer esses campos.
                  </p>
                )}
                <button type="button" onClick={downloadPending} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted">
                  <Download className="h-4 w-4" />Exportar protocolos a conferir (CSV)
                </button>
              </>
            )}
            <p className="text-xs text-muted-foreground">Um relatório anterior usava 162 atendimentos humanos em outubro (−16,9%), mas a auditoria protocolar registra 164. Consideramos 164 como base documentada. Mensagem atribuída a um humano não é sinônimo de resolução; redução de volume não comprova causalidade da IA.</p>
          </div>
        </details>
      </Panel>
    </section>
  );
}
