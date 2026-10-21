import type { AccountContactLink } from "@/lib/ac.functions";

// ── Base muda ────────────────────────────────────────────────────────────────

export type DormancyRow = {
  window: number; // number of most recent sends considered
  active: number; // contacts that opened at least one of them
  dormant: number;
  dormantPct: number;
};

// listSize − unique openers across the last k sends, for k = 1..n.
// `opened` maps contactId → indexes (0 = newest send) of the sends that contact opened.
// Openers can include people who left the list since, so dormant is clamped at 0.
export function dormancyRows(listSize: number, opened: Record<string, number[]>, n: number): DormancyRow[] {
  const freshest = Object.values(opened).map((idxs) => Math.min(...idxs));
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    const openers = freshest.filter((f) => f < k).length;
    const active = Math.min(openers, listSize);
    const dormant = Math.max(0, listSize - openers);
    return { window: k, active, dormant, dormantPct: listSize > 0 ? (dormant / listSize) * 100 : 0 };
  });
}

// ── Engajamento por empresa ──────────────────────────────────────────────────

export type CompanyStatus = "active" | "cooling";

export type CompanyRow = {
  key: string;
  name: string;
  status: CompanyStatus;
  engagedContacts: number; // contacts that opened at least once in the window
  opens: number; // sum of (contact × campaign) opens
  recentContacts: number; // opened in the latest `recent` sends
  lastOpenedIdx: number; // 0 = newest send; smaller is fresher
};

export const NO_COMPANY = "__none__";

// opened: contactId → indexes (0 = newest send) of the campaigns that contact opened.
// A company is "cooling" when its contacts opened before but none of them in the latest sends.
export function buildCompanyEngagement(
  opened: Record<string, number[]>,
  links: AccountContactLink[],
  names: Record<string, string>,
  recent = 2,
): CompanyRow[] {
  const accountOf = new Map<string, string>();
  for (const l of links) if (!accountOf.has(l.contactId)) accountOf.set(l.contactId, l.accountId);

  const acc = new Map<string, { contacts: number; opens: number; recent: number; last: number }>();
  for (const [contactId, idxs] of Object.entries(opened)) {
    const key = accountOf.get(contactId) ?? NO_COMPANY;
    const a = acc.get(key) ?? { contacts: 0, opens: 0, recent: 0, last: Infinity };
    a.contacts++;
    a.opens += idxs.length;
    const freshest = Math.min(...idxs);
    if (freshest < recent) a.recent++;
    a.last = Math.min(a.last, freshest);
    acc.set(key, a);
  }

  return [...acc.entries()]
    .map(([key, a]): CompanyRow => ({
      key,
      name: key === NO_COMPANY ? "Sem empresa vinculada" : (names[key] ?? `Empresa ${key}`),
      status: a.recent > 0 ? "active" : "cooling",
      engagedContacts: a.contacts,
      opens: a.opens,
      recentContacts: a.recent,
      lastOpenedIdx: a.last,
    }))
    .sort((x, y) => y.opens - x.opens);
}
