import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getSettings, saveSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Settings as SettingsIcon2 } from "lucide-react";

export const Route = createFileRoute("/settings")({
  ssr: false,
  component: () => (<AuthGate><SettingsPage /></AuthGate>),
});

function SettingsPage() {
  const navigate = useNavigate();
  const fetchSettings = useServerFn(getSettings);
  const save = useServerFn(saveSettings);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [openR, setOpenR] = useState("22");
  const [ctr, setCtr] = useState("2.9");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setBaseUrl(data.ac_base_url);
      setOpenR(String(data.benchmark_open_rate));
      setCtr(String(data.benchmark_ctr));
    }
  }, [data]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await save({
        data: {
          ...(apiKey ? { ac_api_key: apiKey } : {}),
          ac_base_url: baseUrl,
          benchmark_open_rate: Number(openR),
          benchmark_ctr: Number(ctr),
        },
      });
      toast.success("Configurações salvas");
      setApiKey("");
      await refetch();
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pl-[220px]">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: "#0660FE20" }}>
            <SettingsIcon2 className="h-5 w-5" style={{ color: "#0660FE" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurações</h1>
            <p className="text-sm text-muted-foreground">Configure seu acesso ao ActiveCampaign e os benchmarks.</p>
          </div>
        </div>
        {isLoading ? (
          <div className="mt-8 h-40 animate-pulse rounded-xl bg-surface" />
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-6 rounded-2xl border border-border bg-card p-7">
            <div>
              <Label htmlFor="api">Chave de API do ActiveCampaign</Label>
              <Input id="api" type="password" value={apiKey}
                placeholder={data?.hasApiKey ? "•••••••••• (salva — deixe em branco para manter)" : "Cole seu Api-Token"}
                onChange={(e) => setApiKey(e.target.value)} />
              <p className="mt-1.5 text-xs text-muted-foreground">Armazenada no servidor. Nunca enviada ao navegador.</p>
            </div>
            <div>
              <Label htmlFor="base">URL Base da API</Label>
              <Input id="base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="or">Benchmark de Taxa de Abertura (%)</Label>
                <Input id="or" type="number" step="0.1" value={openR} onChange={(e) => setOpenR(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ctr">Benchmark de CTR (%)</Label>
                <Input id="ctr" type="number" step="0.1" value={ctr} onChange={(e) => setCtr(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Salvando…" : "Salvar configurações"}</Button>
          </form>
        )}
      </main>
    </div>
  );
}
