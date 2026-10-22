import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Headset } from "lucide-react";
import { AuthGate } from "@/components/app/AuthGate";
import { Explainer, PageHeader, PageShell, TabBar } from "@/components/app/ui-kit";
import { AtendimentoProvider, useAtendimento } from "@/components/atendimento/store";
import { CompletenessBanner, DataStrip } from "@/components/atendimento/shared";
import { Filters } from "@/components/atendimento/Filters";
import { SourcePanel } from "@/components/atendimento/SourcePanel";
import { ExecutiveTab } from "@/components/atendimento/ExecutiveTab";
import { BotTab } from "@/components/atendimento/BotTab";
import { ReasonsTab } from "@/components/atendimento/ReasonsTab";
import { EfficiencyTab } from "@/components/atendimento/EfficiencyTab";
import { InsightsTab } from "@/components/atendimento/InsightsTab";

export const Route = createFileRoute("/atendimento")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AtendimentoProvider>
        <AtendimentoPage />
      </AtendimentoProvider>
    </AuthGate>
  ),
});

const TABS = [
  { value: "exec", label: "Visão executiva" },
  { value: "bot", label: "Performance da Duda" },
  { value: "motivos", label: "Motivos de contato" },
  { value: "eficiencia", label: "Eficiência operacional" },
  { value: "inteligencia", label: "Inteligência gerencial" },
  { value: "dados", label: "Fonte de dados" },
] as const;
type TabKey = (typeof TABS)[number]["value"];

function AtendimentoPage() {
  const { dataset } = useAtendimento();
  const [tab, setTab] = useState<TabKey>("exec");
  const hasData = dataset.chats.length > 0;
  const active: TabKey = hasData ? tab : "dados";

  return (
    <PageShell wide>
      <PageHeader
        icon={Headset}
        title="Atendimento"
        description="Eficiência operacional, resultados da Duda e motivos de contato, a partir dos atendimentos da Hyperflow."
      />

      <div className="mb-6">
        <TabBar tabs={hasData ? [...TABS] : TABS.filter((t) => t.value === "dados")} value={active} onChange={setTab} />
      </div>

      {!hasData && (
        <Explainer title="Comece carregando os atendimentos">
          Sincronize com a API da Hyperflow ou importe um arquivo JSON ou CSV. Os indicadores só aparecem com dados reais: nada é simulado, e o que estiver incompleto é sinalizado.
        </Explainer>
      )}

      {hasData && <DataStrip />}
      {hasData && <CompletenessBanner />}
      {hasData && active !== "dados" && <Filters />}

      {active === "exec" && <ExecutiveTab />}
      {active === "bot" && <BotTab />}
      {active === "motivos" && <ReasonsTab />}
      {active === "eficiencia" && <EfficiencyTab />}
      {active === "inteligencia" && <InsightsTab />}
      {active === "dados" && <SourcePanel />}
    </PageShell>
  );
}
