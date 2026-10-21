import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, Settings as SettingsIcon } from "lucide-react";
import { AuthGate } from "@/components/app/AuthGate";
import { Loading, Notice, PageHeader, PageShell, TabBar } from "@/components/app/ui-kit";
import { SeriesTab } from "@/components/analises/SeriesTab";
import { AudienceTab } from "@/components/analises/AudienceTab";
import { ContentTab } from "@/components/analises/ContentTab";
import { TimingTab } from "@/components/analises/TimingTab";
import { useCampaignHistory } from "@/hooks/use-sent-campaigns";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/analises")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AnalisesPage />
    </AuthGate>
  ),
});

const TABS = [
  { value: "series", label: "O que mudou" },
  { value: "base", label: "Contatos que não abrem" },
  { value: "conteudo", label: "O que dá resultado" },
  { value: "horarios", label: "Melhor dia e hora" },
] as const;
type TabKey = (typeof TABS)[number]["value"];

function AnalisesPage() {
  const [tab, setTab] = useState<TabKey>("series");
  const { campaigns, isLoading, error, hasApiKey } = useCampaignHistory();

  return (
    <PageShell>
      <PageHeader
        icon={Activity}
        title="Análises"
        description="O que o ActiveCampaign não mostra sozinho: como cada disparo se compara ao normal dele e o que fazer com isso."
      />
      <div className="mb-6">
        <TabBar tabs={[...TABS]} value={tab} onChange={setTab} />
      </div>

      {!hasApiKey ? (
        <Notice>
          A chave do ActiveCampaign ainda não foi configurada.{" "}
          <Button asChild variant="outline" size="sm" className="ml-2">
            <Link to="/settings">
              <SettingsIcon className="mr-1.5 h-4 w-4" />
              Configurar
            </Link>
          </Button>
        </Notice>
      ) : isLoading ? (
        <Loading rows={5} />
      ) : error ? (
        <Notice tone="bad">{error.message}</Notice>
      ) : (
        <>
          {tab === "series" && <SeriesTab campaigns={campaigns ?? []} />}
          {tab === "base" && <AudienceTab campaigns={campaigns ?? []} />}
          {tab === "conteudo" && <ContentTab campaigns={campaigns ?? []} />}
          {tab === "horarios" && <TimingTab campaigns={campaigns ?? []} />}
        </>
      )}
    </PageShell>
  );
}
