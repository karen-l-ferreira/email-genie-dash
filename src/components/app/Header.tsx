import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Settings as SettingsIcon, Sun, Moon, BarChart3, Bell, TrendingUp, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

type Props = { campaignCount?: number };

const NAV = [
  { label: "Dashboard",  to: "/dashboard",  icon: LayoutDashboard, match: (p: string) => p === "/dashboard" },
  { label: "Fluxos",     to: "/campanhas",  icon: BarChart3,        match: (p: string) => p.startsWith("/campanhas") || p.startsWith("/campaigns") || p.startsWith("/automations") || p.startsWith("/automation") },
  { label: "Influência", to: "/influencia", icon: TrendingUp,       match: (p: string) => p.startsWith("/influencia") },
  { label: "Alertas",    to: "/alertas",    icon: Bell,             match: (p: string) => p.startsWith("/alertas") },
];

export function AppHeader({ campaignCount }: Props) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex w-[220px] flex-col"
      style={{ backgroundColor: "#193469" }}
    >
      {/* Logo */}
      <Link to="/dashboard" className="flex items-center gap-2.5 px-5 py-5 select-none shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded" style={{ backgroundColor: "#0660FE" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-tight text-white">Fluxi</span>
          <span className="text-[9px] font-medium tracking-[0.15em] uppercase text-white/40">by Adiante</span>
        </div>
      </Link>

      {/* Divider */}
      <div className="mx-4 border-t border-white/10" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-widest text-white/30">Menu</p>
        {NAV.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded px-3 py-2.5 text-[13px] font-medium transition-all mb-0.5",
                active
                  ? "bg-white/10 text-white"
                  : "text-white/55 hover:bg-white/5 hover:text-white/85",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
              {active && (
                <span
                  className="ml-auto h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "#0660FE" }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="mx-4 border-t border-white/10" />
      <div className="flex items-center justify-between px-4 py-3">
        <Link
          to="/settings"
          title="Configurações"
          className="flex h-8 w-8 items-center justify-center rounded text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
        <button
          onClick={toggle}
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
          className="flex h-8 w-8 items-center justify-center rounded text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
          title="Sair"
          className="flex h-8 w-8 items-center justify-center rounded text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
