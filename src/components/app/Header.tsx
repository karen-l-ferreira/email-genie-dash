import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Moon, Settings as SettingsIcon, Sun, Zap } from "lucide-react";
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
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between px-6">

        {/* Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
              <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
            </div>
            <span className="text-[13px] font-bold tracking-tight">Fluxi</span>
          </Link>

          <nav className="flex items-center">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "relative px-3 py-3.5 text-[13px] font-medium transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-full bg-primary" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={toggle} title={theme === "dark" ? "Modo claro" : "Modo escuro"}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
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
