import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, BarChart3, Bot, Database, Headset, Lightbulb, MessageSquare, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "@/components/atendimento/atendimento.css";
import { AuthGate } from "@/components/app/AuthGate";
import { PageHeader, PageShell } from "@/components/app/ui-kit";
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
  { value: "exec", label: "Visão geral", icon: BarChart3 },
  { value: "bot", label: "Automação", icon: Bot },
  { value: "motivos", label: "Motivos de contato", icon: MessageSquare },
  { value: "eficiencia", label: "Operação", icon: Timer },
  { value: "inteligencia", label: "Insights", icon: Lightbulb },
] as const;
type TabKey = (typeof TABS)[number]["value"] | "dados";

function AtendimentoPage() {
  const { dataset } = useAtendimento();
  const [tab, setTab] = useState<TabKey>("exec");
  const hasData = dataset.chats.length > 0;
  const active: TabKey = hasData ? tab : "dados";

  return (
    <div className="atendimento-page">
    <PageShell wide>
      <PageHeader
        icon={Headset}
        title="Atendimento"
        description="Uma visão clara da demanda, da automação e da operação."
        actions={hasData && <Button variant="outline" onClick={() => setTab(active === "dados" ? "exec" : "dados")}>
          {active === "dados" ? <ArrowLeft className="mr-2 h-4 w-4" /> : <Database className="mr-2 h-4 w-4" />}
          {active === "dados" ? "Voltar à análise" : "Gerenciar dados"}
        </Button>}
      />

      {hasData && <DataStrip />}
      {hasData && <CompletenessBanner />}

      {hasData && active !== "dados" && <>
        <Filters />
        <nav aria-label="Análises de atendimento" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" aria-current={active === value ? "page" : undefined}
              onClick={() => setTab(value)}
              className={cn("flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                active === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <Icon className="h-4 w-4" aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
      </>}

      {!hasData && <section className="mb-6 rounded-2xl border border-primary/15 bg-primary/5 p-6 sm:p-8">
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Análise de atendimento</span>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Entenda o que acontece em cada atendimento.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Conecte a Hyperflow ou importe seus arquivos para acompanhar volume, transferências e motivos de contato.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[{ icon: BarChart3, title: "Demanda", text: "Volume e evolução por departamento." },
            { icon: Bot, title: "Automação", text: "Participação dos agentes configurados e apoio humano." },
            { icon: Timer, title: "Operação", text: "Tempos, distribuição e oportunidades de melhoria." }].map(({ icon: Icon, title, text }) =>
            <div key={title} className="flex items-start gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p></div></div>)}
        </div>
      </section>}

      {active === "exec" && <ExecutiveTab />}
      {active === "bot" && <BotTab />}
      {active === "motivos" && <ReasonsTab />}
      {active === "eficiencia" && <EfficiencyTab />}
      {active === "inteligencia" && <InsightsTab />}
      {active === "dados" && <SourcePanel />}
    </PageShell>
    </div>
  );
}
