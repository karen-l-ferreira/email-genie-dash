import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Settings as SettingsIcon, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

type Props = { campaignCount?: number };

const NAV = [
  { label: "Dashboard",  to: "/dashboard",  match: (p: string) => p === "/dashboard" },
  { label: "Fluxos",     to: "/campanhas",   match: (p: string) => p.startsWith("/campanhas") || p.startsWith("/campaigns") || p.startsWith("/automations") || p.startsWith("/automation") },
  { label: "Influência", to: "/influencia",  match: (p: string) => p.startsWith("/influencia") },
  { label: "Alertas",    to: "/alertas",     match: (p: string) => p.startsWith("/alertas") },
];

export function AppHeader({ campaignCount }: Props) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30" style={{ backgroundColor: "#193469" }}>
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">

        {/* Logo */}
        <div className="flex items-center gap-10">
          <Link to="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <div
              className="flex h-7 w-7 items-center justify-center rounded"
              style={{ backgroundColor: "#0660FE" }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 7L7 13M1 7H13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-[15px] font-bold tracking-tight text-white">
              Fluxi
            </span>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "relative px-3.5 py-4 text-[13px] font-medium tracking-wide transition-colors",
                    active
                      ? "text-white"
                      : "text-white/55 hover:text-white/85",
                  )}
                >
                  {item.label}
                  {active && (
                    <span
                      className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-sm"
                      style={{ backgroundColor: "#0660FE" }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            title={theme === "dark" ? "Modo claro" : "Modo escuro"}
            className="flex h-8 w-8 items-center justify-center rounded text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <Link
            to="/settings"
            className="flex h-8 w-8 items-center justify-center rounded text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>

          <button
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
            title="Sair"
            className="flex h-8 w-8 items-center justify-center rounded text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
