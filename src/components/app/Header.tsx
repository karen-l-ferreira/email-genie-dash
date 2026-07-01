import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Bell, LogOut, Moon, Search, Settings as SettingsIcon, Sun, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

type Props = { campaignCount?: number };

const NAV = [
  { label: "Dashboard",  to: "/dashboard",   match: (p: string) => p === "/dashboard" },
  { label: "Fluxos",     to: "/campanhas",    match: (p: string) => p.startsWith("/campanhas") || p.startsWith("/campaigns") || p.startsWith("/automations") || p.startsWith("/automation") },
  { label: "Influência", to: "/influencia",   match: (p: string) => p.startsWith("/influencia") },
  { label: "Alertas",    to: "/alertas",      match: (p: string) => p.startsWith("/alertas") },
];

export function AppHeader({ campaignCount }: Props) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">

        {/* Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link to="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Zap className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Fluxi</span>
          </Link>

          <nav className="flex items-center border-b-0">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "px-3 py-1.5 text-sm transition-colors rounded-md",
                    active
                      ? "text-foreground font-medium bg-muted"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground text-xs h-8"
            onClick={() => document.dispatchEvent(new Event("crm:search"))}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Buscar</span>
            <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </Button>

          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggle} title={theme === "dark" ? "Modo claro" : "Modo escuro"}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Link to="/settings"><SettingsIcon className="h-4 w-4" /></Link>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
            title="Sair"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
