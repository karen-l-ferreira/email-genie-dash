import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Activity, LogOut, Settings as SettingsIcon } from "lucide-react";

type Props = { campaignCount?: number };

export function AppHeader({ campaignCount }: Props) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <Activity className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">CRM Analytica</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">ActiveCampaign Intelligence</div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          {typeof campaignCount === "number" && (
            <Badge className="border-success/30 bg-success/15 font-mono text-success hover:bg-success/15">
              ● {campaignCount} campaigns loaded
            </Badge>
          )}
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
            <LogOut className="mr-1.5 h-4 w-4" /> Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
}