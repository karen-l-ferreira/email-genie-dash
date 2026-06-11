import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Activity, BarChart3, GitBranch, LogOut, Mail, Moon, ScanText, Search, Settings as SettingsIcon, Sun, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

type Props = { campaignCount?: number };

export function AppHeader({ campaignCount }: Props) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <Activity className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">CRM Analytica</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">ActiveCampaign Intelligence</div>
            </div>
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              to="/dashboard"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname === "/dashboard" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <Link
              to="/campanhas"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith("/campanhas") || pathname.startsWith("/campaigns")
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Mail className="h-3.5 w-3.5" />
              Campanhas
            </Link>
            <Link
              to="/automations"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith("/automations") ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Automações
            </Link>
            <Link
              to="/analisar"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith("/analisar") ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ScanText className="h-3.5 w-3.5" />
              Analisar
            </Link>
            <Link
              to="/influencia"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith("/influencia") ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              Influência
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {typeof campaignCount === "number" && (
            <Badge className="border-success/30 bg-success/15 font-mono text-success hover:bg-success/15">
              ● {campaignCount} carregadas
            </Badge>
          )}

          {/* Busca global */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => document.dispatchEvent(new Event("crm:search"))}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline text-xs">Buscar</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </Button>

          {/* Toggle tema */}
          <Button variant="ghost" size="sm" onClick={toggle} title={theme === "dark" ? "Modo claro" : "Modo escuro"}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button asChild variant="ghost" size="sm">
            <Link to="/settings"><SettingsIcon className="h-4 w-4" /></Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/login" });
            }}
          >
            <LogOut className="mr-1.5 h-4 w-4" /> Sair
          </Button>
        </div>
      </div>
    </header>
  );
}
