import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
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
    <header className="sticky top-0 z-30 border-b border-white/10" style={{ backgroundColor: "#193469" }}>
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">

        {/* Logo */}
        <div className="flex items-center gap-10">
          <Link to="/dashboard" className="flex items-center gap-2.5 shrink-0 select-none">
            {/* Logo mark */}
            <div className="flex h-8 w-8 items-center justify-center rounded" style={{ backgroundColor: "#0660FE" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[15px] font-bold tracking-tight text-white">Fluxi</span>
              <span className="text-[9px] font-medium tracking-[0.15em] uppercase text-white/40">by Adiante</span>
            </div>
          </Link>

          {/* Nav */}
          <nav className="flex items-center">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "relative px-4 py-4 text-[13px] font-medium transition-colors",
                    active ? "text-white" : "text-white/50 hover:text-white/80",
                  )}
                >
                  {item.label}
                  {active && (
                    <span
                      className="absolute inset-x-3 bottom-0 h-[2px] rounded-t"
                      style={{ backgroundColor: "#0660FE" }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5">
          <IconBtn onClick={toggle} title={theme === "dark" ? "Modo claro" : "Modo escuro"}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconBtn>
          <Link
            to="/settings"
            className="flex h-8 w-8 items-center justify-center rounded text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
          <IconBtn
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
            title="Sair"
          >
            <LogOut className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>
    </header>
  );
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded text-white/50 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}
