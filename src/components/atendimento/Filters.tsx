import { useState } from "react";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Segmented, selectClass } from "@/components/app/ui-kit";
import { endOfDay, startOfDay } from "@/lib/hyperflow/metrics";
import { useAtendimento, type Preset } from "./store";

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function Filters() {
  const { filters, setFilters, preset, setPreset, deptOptions, agentOptions, classificationOptions, scoped, dataMax, dataset } = useAtendimento();
  const [expanded, setExpanded] = useState(false);
  const activeCount = Number(!!filters.agent) + Number(!!filters.classification) + Number(filters.includeCampaigns) + Number(deptOptions.some((d) => filters.departments.includes(d.name) !== d.inDefault));
  const reset = () => {
    setFilters({ agent: null, classification: null, includeCampaigns: false, departments: deptOptions.filter((d) => d.inDefault).map((d) => d.name) });
    setPreset("30");
  };
  const toggleDept = (name: string) =>
    setFilters({ departments: filters.departments.includes(name) ? filters.departments.filter((d) => d !== name) : [...filters.departments, name] });
  const { stats } = scoped;
  const hasInDefault = deptOptions.some((d) => d.inDefault);

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Período de análise
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Preset>
              size="sm"
              value={preset}
              onChange={setPreset}
              options={[
                { value: "7", label: "7 dias" },
                { value: "30", label: "30 dias" },
                { value: "90", label: "90 dias" },
                { value: "all", label: "Tudo" },
              ]}
            />
            <input
              type="date"
              max={ymd(filters.end)}
              aria-label="Data inicial"
              className={selectClass}
              value={ymd(filters.start)}
              onChange={(e) => e.target.value && e.target.value <= ymd(filters.end) && (setFilters({ start: startOfDay(fromYmd(e.target.value)) }), setPreset("custom"))}
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              min={ymd(filters.start)}
              aria-label="Data final"
              className={selectClass}
              value={ymd(filters.end)}
              onChange={(e) => e.target.value && e.target.value >= ymd(filters.start) && (setFilters({ end: endOfDay(fromYmd(e.target.value)) }), setPreset("custom"))}
            />
          </div>
        </div>

        <button type="button" aria-expanded={expanded} aria-controls="atendimento-filtros" onClick={() => setExpanded(!expanded)} className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">
          <SlidersHorizontal className="h-4 w-4" /> Mais filtros{activeCount > 0 && <span className="rounded-full bg-primary px-1.5 text-primary-foreground">{activeCount}</span>}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
        <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><RotateCcw className="h-3.5 w-3.5" /> Redefinir</button>
      </div>
      {dataMax && <p className="mt-2 text-xs text-muted-foreground">Atalhos de período terminam em {dataMax.toLocaleDateString("pt-BR")}, data do atendimento mais recente.</p>}
      <p className="mt-2 break-words text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Escopo: </span>
        {filters.departments.length ? filters.departments.join(", ") : "Nenhum departamento selecionado — abra Mais filtros para escolher"}
        {filters.agent && ` · Agente: ${filters.agent}`}
        {filters.classification && ` · Classificação: ${filters.classification}`}
        {filters.includeCampaigns ? " · Com campanhas" : " · Sem campanhas"}
      </p>
      <div id="atendimento-filtros" hidden={!expanded}>
      <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-4">

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Agente</span>
          <select className={cn(selectClass, "min-w-[180px]")} value={filters.agent ?? ""} onChange={(e) => setFilters({ agent: e.target.value || null })}>
            <option value="">Todos</option>
            {agentOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Classificação</span>
          <select className={cn(selectClass, "min-w-[200px]")} value={filters.classification ?? ""} onChange={(e) => setFilters({ classification: e.target.value || null })}>
            <option value="">Todas</option>
            {classificationOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={filters.includeCampaigns} onChange={(e) => setFilters({ includeCampaigns: e.target.checked })} className="h-4 w-4 accent-[#0660FE]" />
          <span>
            Incluir campanhas
            <span className="block text-[11px] text-muted-foreground">{scoped.campaigns.length.toLocaleString("pt-BR")} no período (broadcast)</span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Departamentos</span>
        {deptOptions.map((d) => {
          const on = filters.departments.includes(d.name);
          return (
            <button
              key={d.name}
              type="button"
              onClick={() => toggleDept(d.name)}
              aria-pressed={on}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
              title={d.comercial ? "Fora dos indicadores por padrão" : d.inDefault ? "Dentro do escopo padrão" : "Fora do escopo padrão"}
            >
              {d.name}
              {d.comercial && <span className="ml-1 font-normal opacity-70">(fora do padrão)</span>}
            </button>
          );
        })}
        {deptOptions.length > 0 && !hasInDefault && (
          <span className="text-xs text-destructive">Nenhum departamento Carteira, CX ou Aquisição foi encontrado nos dados. Escolha os que devem entrar.</span>
        )}
      </div>

      </div>
      {dataset.chats.length > 0 && expanded && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Fora dos indicadores, mas contados: {stats.undated.toLocaleString("pt-BR")} sem data válida · {stats.noDepartment.toLocaleString("pt-BR")} sem departamento ·{" "}
          {stats.otherDepartments.toLocaleString("pt-BR")} em departamentos não selecionados · {stats.outsidePeriod.toLocaleString("pt-BR")} fora do período.
        </p>
      )}
    </div>
  );
}
