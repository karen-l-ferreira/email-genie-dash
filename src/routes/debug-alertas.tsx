import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/app/Header";
import { Loader2 } from "lucide-react";
import { debugAlertasFields } from "@/lib/alertas.functions";

export const Route = createFileRoute("/debug-alertas")({
  component: DebugAlertasPage,
});

function DebugAlertasPage() {
  const fetchFn = useServerFn(debugAlertasFields);
  const q = useQuery({ queryKey: ["debug-alertas"], queryFn: () => fetchFn({ data: undefined }) });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1000px] px-6 py-8 space-y-8">
        <h1 className="text-xl font-semibold">Debug — Campos de Conta & Alertas Enviados</h1>

        {q.isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>}
        {q.error && <div className="text-destructive text-sm">{(q.error as Error).message}</div>}

        {q.data && (
          <>
            <section>
              <h2 className="font-medium mb-2">Campos de Conta no ActiveCampaign ({q.data.acctFields.length})</h2>
              <div className="rounded-lg border border-border overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left">ID</th>
                      <th className="px-3 py-2 text-left">perstag</th>
                      <th className="px-3 py-2 text-left">fieldLabel</th>
                      <th className="px-3 py-2 text-left">tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.acctFields.map((f: any) => (
                      <tr key={f.id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono">{f.id}</td>
                        <td className="px-3 py-2 font-mono text-primary">{f.perstag ?? "—"}</td>
                        <td className="px-3 py-2">{f.fieldLabel ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{f.fieldType ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="font-medium mb-2">
                Empresa de exemplo: {q.data.sampleAccount?.name ?? "nenhuma"} (ID: {q.data.sampleAccount?.id ?? "—"})
              </h2>
              {q.data.sampleFieldValues.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum campo preenchido nessa empresa.</p>
              ) : (
                <div className="rounded-lg border border-border overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left">customFieldId</th>
                        <th className="px-3 py-2 text-left">fieldValue (valor cru)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.sampleFieldValues.map((fv: any) => (
                        <tr key={fv.customFieldId} className="border-t border-border">
                          <td className="px-3 py-2 font-mono">{fv.customFieldId}</td>
                          <td className="px-3 py-2 font-mono">{String(fv.fieldValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="font-medium mb-2">
                Alertas Enviados — total na tabela: <span className="text-primary">{q.data.alertasEnviadosTotal}</span>
              </h2>
              {q.data.alertasEnviadosRecentes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum registro encontrado na tabela alertas_enviados para este usuário.</p>
              ) : (
                <div className="rounded-lg border border-border overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left">ID</th>
                        <th className="px-3 py-2 text-left">cliente_nome</th>
                        <th className="px-3 py-2 text-left">data_envio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.alertasEnviadosRecentes.map((r: any) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-3 py-2 font-mono">{r.id}</td>
                          <td className="px-3 py-2">{r.cliente_nome ?? "—"}</td>
                          <td className="px-3 py-2">{r.data_envio ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
