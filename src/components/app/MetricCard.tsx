import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  detail?: string;
  variance?: number;
  invertColor?: boolean;
};

export function MetricCard({ label, value, detail, variance, invertColor }: Props) {
  const positive = variance !== undefined && (invertColor ? variance < 0 : variance > 0);
  const negative = variance !== undefined && (invertColor ? variance > 0 : variance < 0);
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-surface-2">
      <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-3 font-mono text-3xl font-semibold tabular-nums text-foreground">{value}</div>
      {detail && <div className="mt-1 font-mono text-xs text-muted-foreground">{detail}</div>}
      {variance !== undefined && (
        <div
          className={cn(
            "mt-3 inline-flex rounded-md px-2 py-0.5 font-mono text-xs",
            positive && "bg-success/15 text-success",
            negative && "bg-destructive/15 text-destructive",
            !positive && !negative && "bg-muted text-muted-foreground",
          )}
        >
          {variance > 0 ? "+" : ""}
          {variance.toFixed(1)} pts vs benchmark
        </div>
      )}
    </div>
  );
}
