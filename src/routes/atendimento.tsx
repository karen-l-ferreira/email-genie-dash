import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Headset, Database, LayoutDashboard, Bot, ListFilter, Timer, Lightbulb, RefreshCcw } from "lucide-react";
import { AuthGate } from "@/components/app/AuthGate";
import { PageShell, Tag } from "@/components/app/ui-kit";
import { AtendimentoProvider, useAtendimento } from "@/components/atendimento/store";
import { CompletenessBanner, DataStrip } from "@/components/atendimento/shared";
import { Filters } from "@/components/atendimento/Filters";
import { SourcePanel } from "@/components/atendimento/SourcePanel";
import { ExecutiveTab } from "@/components/atendimento/ExecutiveTab";
import { BotTab } from "@/components/atendimento/BotTab";
import { ReasonsTab } from "@/components/atendimento/ReasonsTab";
import { EfficiencyTab } from "@/components/atendimento/EfficiencyTab";
import { InsightsTab } from "@/components/atendimento/InsightsTab";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/hyperflow/metrics";

export const Route = createFileRoute("/atendimento")({
  ssr: false,
  component: () => <AuthGate><AtendimentoProvider><AtendimentoPage /></AtendimentoProvider></AuthGate>,
});

const TABS = [
  { value: "exec", label: "Visão geral", icon: LayoutDashboard },
  { value: "bot", label: "Assistentes de IA", icon: Bot },
  { value: "motivos", label: "Motivos", icon: ListFilter },
  { value: "eficiencia", label: "Eficiência", icon: Timer },
  { value: "inteligencia", label: "Análise gerencial", icon: Lightbulb },
  { value: "dados", label: "Dados e integrações", icon: Database },
] as const;
type TabKey = (typeof TABS)[number]["value"];

function AtendimentoPage() {
  const { dataset, scoped, filters } = useAtendimento();
  const [tab, setTab] = useState<TabKey>("exec");
  const [showFilters, setShowFilters] = useState(false);
  const hasData = dataset.chats.length > 0;
  const active: TabKey = hasData ? tab : "dados";
  const incomplete = dataset.completeness !== "complete";
  return (
    <PageShell wide>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Headset className="h-6 w-6" /></div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">Inteligência operacional</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Atendimento</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Visão do volume, participação dos assistentes de IA e oportunidades de melhoria na operação.</p>
          </div>
        </div>
        {hasData && <button type="button" onClick={() => setTab("dados")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"><RefreshCcw className="h-4 w-4" />Atualizar dados</button>}
      </header>

      {hasData && <div className="mb-5"><DataStrip /></div>}
      {hasData && <CompletenessBanner />}
      {hasData && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Período</span>
          <span>{filters.start.toLocaleDateString("pt-BR")} – {filters.end.toLocaleDateString("pt-BR")}</span>
          <span className="hidden text-border sm:inline">|</span>
          <span>{fmtInt(scoped.operational.length)} atendimentos filtrados</span>
          {incomplete && <Tag tone="warn">Base {dataset.completeness === "incomplete" ? "parcial" : "não verificada"}</Tag>}
        </div>
        <button type="button" onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters} className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/15">{showFilters ? "Ocultar filtros" : "Ajustar filtros"}</button>
      </div>}
      {hasData && showFilters && <Filters />}

      <nav aria-label="Seções do atendimento" className="mb-7 flex gap-1 overflow-x-auto border-b border-border pb-px">
        {(hasData ? TABS : TABS.filter(t => t.value === "dados")).map(t => {
          const Icon = t.icon;
          return <button key={t.value} type="button" onClick={() => setTab(t.value)} aria-current={active === t.value ? "page" : undefined} className={cn("flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors", active === t.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><Icon className="h-4 w-4" />{t.label}</button>;
        })}
      </nav>
      {!hasData && <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 px-5 py-5"><h2 className="text-base font-semibold text-foreground">Conecte os dados para começar</h2><p className="mt-1 text-sm text-muted-foreground">Sincronize os atendimentos da Hyperflow ou importe um arquivo JSON/CSV. Os indicadores só serão exibidos após o carregamento; não usamos números simulados.</p></div>}
      {active === "exec" && <ExecutiveTab />}
      {active === "bot" && <BotTab />}
      {active === "motivos" && <ReasonsTab />}
      {active === "eficiencia" && <EfficiencyTab />}
      {active === "inteligencia" && <InsightsTab />}
      {active === "dados" && <SourcePanel />}
    </PageShell>
  );
}
