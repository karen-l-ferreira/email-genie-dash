const KEY = "crm_campaign_history";
const MAX = 50;

export type HistoryEntry = {
  id: string;
  name: string;
  sdate: string | null;
  open_rate: number;
  ctr: number;
  viewedAt: string;
};

export function readCampaignHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addToCampaignHistory(entry: Omit<HistoryEntry, "viewedAt">) {
  const prev = readCampaignHistory().filter((h) => h.id !== entry.id);
  const next = [{ ...entry, viewedAt: new Date().toISOString() }, ...prev].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
}
