import { useRef, useState } from "react";
import { CloudDownload, FileUp, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, Panel, Tag, selectClass } from "@/components/app/ui-kit";
import { DOCUMENTED_FIELDS } from "@/lib/hyperflow/normalize";
import { endOfDay, fmtInt, startOfDay } from "@/lib/hyperflow/metrics";
import { cn } from "@/lib/utils";
import { useAtendimento } from "./store";

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function SourcePanel({ compact }: { compact?: boolean }) {
  const { dataset, hasKey, sync, startSync, importFiles, importLog, clear } = useAtendimento();
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 59 * 86400000)));
  const [to, setTo] = useState(ymd(today));
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = (list: FileList | null) => {
    if (list && list.length > 0) void importFiles([...list]);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sincronizar com a API da Hyperflow" description="Busca os atendimentos direto da API, página por página, com novas tentativas em caso de limite (429) ou indisponibilidade (502).">
          {hasKey === false ? (
            <Notice>
              <p className="flex items-center gap-2 font-medium text-foreground">
                <KeyRound className="h-4 w-4" />
                Pendência de configuração
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                A chave da API ainda não está configurada no servidor. Cadastre o segredo <code className="rounded bg-muted px-1">HYPERFLOW_API_KEY</code> nas variáveis do projeto (nunca no código
                nem na tela). Enquanto isso, use a importação de arquivo ao lado.
              </p>
            </Notice>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">De</span>
                  <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={selectClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Até</span>
                  <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={selectClass} />
                </label>
                <Button
                  disabled={sync.running || hasKey === undefined || !from || !to}
                  onClick={() => void startSync(startOfDay(fromYmd(from)), endOfDay(fromYmd(to)))}
                  className="h-9"
                >
                  {sync.running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}
                  {sync.running ? "Sincronizando…" : "Sincronizar"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Use pelo menos o dobro do período que pretende analisar: a comparação com o período anterior precisa dos dois.</p>
              {sync.running && (
                <div role="status" aria-live="polite" className="space-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                  <p className="tabular-nums">{fmtInt(sync.pages)} página(s) carregada(s) · {fmtInt(sync.docs)} registros</p>
                  <p>{sync.message ?? "A sincronização está em andamento. Mantenha esta aba aberta até finalizar."}</p>
                </div>
              )}
              {sync.message && !sync.running && <Notice tone={sync.failed ? "bad" : "info"}>{sync.message}</Notice>}
            </div>
          )}
        </Panel>

        <Panel title="Importar arquivo" description="Aceita JSON (lista de atendimentos ou a resposta da API com a chave docs) e CSV. Pode importar vários arquivos; atendimentos repetidos são unidos pelo _id.">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border bg-surface/50",
            )}
          >
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-foreground">Arraste os arquivos aqui ou</p>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              Escolher arquivos
            </Button>
            <input ref={fileRef} type="file" multiple accept=".json,.csv,.txt,application/json,text/csv" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            <p className="text-[11px] text-muted-foreground">Os dados ficam só na memória desta aba. Nada é salvo nem enviado para outro lugar.</p>
          </div>
          {importLog.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {importLog.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <Tag tone={l.ok ? "good" : "bad"}>{l.ok ? "lido" : "recusado"}</Tag>
                  <span className="text-muted-foreground">
                    <strong className="font-medium text-foreground">{l.name}</strong>: {l.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Como preparar o CSV</summary>
            <p className="mt-2 leading-relaxed">
              Use os nomes de campo da API como cabeçalho, por exemplo <code className="rounded bg-muted px-1">_id</code>, <code className="rounded bg-muted px-1">createdAt</code>,{" "}
              <code className="rounded bg-muted px-1">department.name</code>, <code className="rounded bg-muted px-1">agent.name</code>,{" "}
              <code className="rounded bg-muted px-1">classifications.name</code>, <code className="rounded bg-muted px-1">interactions.agent.name</code>. Quando uma célula tiver vários valores
              (classificações, interações), separe-os por <code className="rounded bg-muted px-1">;</code> ou <code className="rounded bg-muted px-1">|</code>. Registros sem <code className="rounded bg-muted px-1">_id</code>{" "}
              são recusados e contados.
            </p>
          </details>
        </Panel>
      </div>

      {!compact && dataset.sources.length > 0 && (
        <Panel
          title="Cobertura dos campos"
          description="Quantos registros trazem cada campo documentado. Campo ausente limita o indicador que depende dele, e esses registros continuam contados."
          actions={
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={clear}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Limpar dados
            </Button>
          }
          flush
        >
          <div className="grid gap-x-8 gap-y-0 p-6 sm:grid-cols-2 lg:grid-cols-3">
            {DOCUMENTED_FIELDS.map((f) => {
              const n = dataset.fieldCoverage[f] ?? 0;
              const share = dataset.rawCount > 0 ? n / dataset.rawCount : 0;
              return (
                <div key={f} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs">
                  <code className="truncate text-foreground">{f}</code>
                  <span className={cn("shrink-0 tabular-nums", share === 0 ? "text-destructive" : share < 0.8 ? "text-warning" : "text-muted-foreground")}>
                    {(share * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
