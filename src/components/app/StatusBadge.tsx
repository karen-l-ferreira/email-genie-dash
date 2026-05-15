import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CAMPAIGN_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  "0": { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  "1": { label: "Agendada", cls: "bg-warning/15 text-warning" },
  "2": { label: "Enviando", cls: "bg-primary/15 text-primary" },
  "3": { label: "Pausada", cls: "bg-muted text-muted-foreground" },
  "4": { label: "Interrompida", cls: "bg-destructive/15 text-destructive" },
  "5": { label: "Concluída", cls: "bg-success/15 text-success" },
  "6": { label: "Desativada", cls: "bg-muted text-muted-foreground" },
};

const AUTOMATION_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: "Ativa", cls: "bg-success/15 text-success" },
  inactive: { label: "Inativa", cls: "bg-muted text-muted-foreground" },
  draft: { label: "Rascunho", cls: "bg-warning/15 text-warning" },
};

export function CampaignStatusBadge({ status }: { status: string }) {
  const m = CAMPAIGN_STATUS_MAP[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return <Badge className={cn("border-transparent font-medium", m.cls)}>{m.label}</Badge>;
}

export function AutomationStatusBadge({ status }: { status: string }) {
  const m = AUTOMATION_STATUS_MAP[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return <Badge className={cn("border-transparent font-medium", m.cls)}>{m.label}</Badge>;
}
