import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { GitBranch, LayoutDashboard, Mail, Settings } from "lucide-react";
import type { Campaign, Automation } from "@/lib/ac.functions";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onEvent() { setOpen(true); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("crm:search", onEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("crm:search", onEvent);
    };
  }, []);

  const campaigns: Campaign[] =
    qc.getQueryData<{ campaigns: Campaign[] }>(["campaigns", 0])?.campaigns ?? [];
  const automations: Automation[] =
    qc.getQueryData<{ automations: Automation[] }>(["automations"])?.automations ?? [];

  function go(to: string) {
    setOpen(false);
    navigate({ to } as Parameters<typeof navigate>[0]);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar campanhas, automações…" />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

        <CommandGroup heading="Páginas">
          <CommandItem value="dashboard" onSelect={() => go("/dashboard")}>
            <LayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
            Dashboard
          </CommandItem>
          <CommandItem value="campanhas" onSelect={() => go("/campanhas")}>
            <Mail className="mr-2 h-4 w-4 text-muted-foreground" />
            Campanhas
          </CommandItem>
          <CommandItem value="automações" onSelect={() => go("/automations")}>
            <GitBranch className="mr-2 h-4 w-4 text-muted-foreground" />
            Automações
          </CommandItem>
          <CommandItem value="configurações" onSelect={() => go("/settings")}>
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
            Configurações
          </CommandItem>
        </CommandGroup>

        {campaigns.length > 0 && (
          <CommandGroup heading="Campanhas">
            {campaigns.map((c) => (
              <CommandItem
                key={c.id}
                value={`campanha ${c.name}`}
                onSelect={() => go(`/campaigns/${c.id}`)}
              >
                <Mail className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
                  {c.open_rate.toFixed(1)}% ab.
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {automations.length > 0 && (
          <CommandGroup heading="Automações">
            {automations.map((a) => (
              <CommandItem
                key={a.id}
                value={`automação ${a.name}`}
                onSelect={() => go(`/automations/${a.id}`)}
              >
                <GitBranch className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{a.name}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {a.status === "active" ? "ativa" : "inativa"}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
