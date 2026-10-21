import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Settings = { ac_api_key: string; ac_base_url: string };

const AC_HOST_RE = /^[a-z0-9-]+\.(api-[a-z0-9]+\.com|activehosted\.com)$/i;

function assertAllowedAcUrl(u: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error("INVALID_AC_BASE_URL");
  }
  if (parsed.protocol !== "https:" || !AC_HOST_RE.test(parsed.hostname)) {
    throw new Error("INVALID_AC_BASE_URL");
  }
  return parsed;
}

function friendlyAcError(status: number): Error {
  if (status === 401 || status === 403) return new Error("ActiveCampaign: verifique sua chave de API.");
  if (status === 404) return new Error("ActiveCampaign: recurso não encontrado.");
  if (status === 429) return new Error("ActiveCampaign: limite de requisições atingido. Tente novamente em instantes.");
  if (status >= 500) return new Error("ActiveCampaign: serviço indisponível no momento.");
  return new Error("ActiveCampaign: falha na requisição.");
}

// Single shared ActiveCampaign account for the whole team — key lives only as a
// server secret (never in the database), same pattern as GOOGLE_AI_API_KEY.
async function getCreds(_supabase: any, _userId: string): Promise<Settings> {
  const ac_api_key = process.env.AC_API_KEY;
  const ac_base_url = process.env.AC_BASE_URL;
  if (!ac_api_key || !ac_base_url) throw new Error("MISSING_API_KEY");
  return { ac_api_key, ac_base_url };
}

async function acLegacyFetch(creds: Settings, params: Record<string, string>) {
  const baseParsed = assertAllowedAcUrl(creds.ac_base_url);
  const url = new URL("/admin/api.php", baseParsed.origin);
  if (url.protocol !== "https:" || url.hostname !== baseParsed.hostname) throw new Error("INVALID_AC_BASE_URL");
  url.searchParams.set("api_key", creds.ac_api_key);
  url.searchParams.set("api_output", "json");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { redirect: "manual" });
  if (!res.ok) throw new Error(`AC legacy ${res.status}`);
  return res.json();
}

async function acFetch(creds: Settings, path: string, params?: Record<string, string>) {
  const baseParsed = assertAllowedAcUrl(creds.ac_base_url);
  const baseStr = baseParsed.toString().endsWith("/") ? baseParsed.toString() : baseParsed.toString() + "/";
  const url = new URL(path.replace(/^\//, ""), baseStr);
  // Defense-in-depth: ensure resolved URL still matches the allowlisted host/protocol.
  if (url.protocol !== "https:" || url.hostname !== baseParsed.hostname) {
    throw new Error("INVALID_AC_BASE_URL");
  }
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  let lastErr: Error = new Error("ActiveCampaign: request failed");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const res = await fetch(url.toString(), {
      headers: { "Api-Token": creds.ac_api_key, Accept: "application/json" },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      console.error("[acFetch] blocked redirect", { status: res.status });
      throw new Error("INVALID_AC_BASE_URL");
    }
    if (res.status === 429) {
      lastErr = friendlyAcError(429);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[acFetch] upstream error", { status: res.status, body: text.slice(0, 500) });
      throw friendlyAcError(res.status);
    }
    return res.json();
  }
  throw lastErr;
}

// ─── Campaign ─────────────────────────────────────────────────────────────────

export type Campaign = {
  id: string;
  name: string;
  status: string;
  type: string;
  cdate: string | null;
  sdate: string | null;
  ldate: string | null;
  send_amt: number;
  total_amt: number;
  opens: number;
  uniqueopens: number;
  linkclicks: number;
  uniquelinkclicks: number;
  hardbounces: number;
  softbounces: number;
  unsubscribes: number;
  message_ids: string[];
  open_rate: number;
  ctr: number;
  score: number;
  listId: string | null;
};

export type CampaignMessage = {
  id: string;
  subject: string;
  html: string;
  fromname: string;
  fromemail: string;
};

function parseAcDate(s: string | null | undefined): string | null {
  if (!s || s.startsWith("0000")) return null;
  return s;
}

function mapCampaign(c: any): Campaign {
  const send = Number(c.send_amt ?? c.total_amt ?? 0);
  const uo = Number(c.uniqueopens ?? 0);
  // AC's own "uniquelinkclicks" counts per (contact, link) pair, so a contact who
  // clicks 2 different links counts twice — it doesn't match the "Cliques únicos"
  // ActiveCampaign shows on its campaign report screen. "subscriberclicks" is the
  // per-contact-deduped count and is what matches the AC UI.
  const ulc = Number(c.subscriberclicks ?? c.uniquelinkclicks ?? 0);
  const open_rate = send > 0 ? (uo / send) * 100 : 0;
  const ctr = send > 0 ? (ulc / send) * 100 : 0;
  const score = Math.min(100, Math.round(open_rate * 2 + ctr * 8));

  const ids: string[] = [];
  if (Array.isArray(c.relmessages)) {
    c.relmessages.forEach((id: any) => { if (id) ids.push(String(id)); });
  }
  if (ids.length === 0 && c.message_id) ids.push(String(c.message_id));

  // sdate = scheduled send date; ldate = last activity date. Prefer sdate, fall back to ldate.
  const sdate = parseAcDate(c.sdate) ?? parseAcDate(c.ldate);

  return {
    id: String(c.id),
    name: c.name ?? "(untitled)",
    status: String(c.status ?? "0"),
    type: c.type ?? "single",
    cdate: parseAcDate(c.cdate),
    sdate,
    ldate: parseAcDate(c.ldate),
    send_amt: send,
    total_amt: Number(c.total_amt ?? 0),
    opens: Number(c.opens ?? 0),
    uniqueopens: uo,
    linkclicks: Number(c.linkclicks ?? 0),
    uniquelinkclicks: ulc,
    hardbounces: Number(c.hardbounces ?? 0),
    softbounces: Number(c.softbounces ?? 0),
    unsubscribes: Number(c.unsubscribes ?? 0),
    message_ids: ids,
    open_rate,
    ctr,
    score,
    listId: c.list ? String(c.list) : null,
  };
}

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offset: z.number().int().min(0).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, "campaigns", {
      limit: "100",
      offset: String(data.offset ?? 0),
      orders: "sdate",
      "orders[sdate]": "DESC",
    });
    const campaigns: Campaign[] = (json.campaigns ?? []).map(mapCampaign);
    return { campaigns, total: Number(json.meta?.total ?? campaigns.length) };
  });

export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, `campaigns/${data.id}`);
    const campaign = mapCampaign(json.campaign);

    let html = "";
    let subject = "";
    const firstId = campaign.message_ids[0];
    if (firstId) {
      try {
        const m = await acFetch(creds, `messages/${firstId}`);
        html = m.message?.html ?? "";
        subject = m.message?.subject ?? "";
      } catch (e) {
        console.error("message fetch failed", e);
      }
    }
    return { campaign, html, subject };
  });

export const getEmailHtml = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ messageId: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const m = await acFetch(creds, `messages/${data.messageId}`);
    return { html: m.message?.html ?? "", subject: m.message?.subject ?? "" };
  });

export const getCampaignMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, `campaigns/${data.id}`);
    const campaign = mapCampaign(json.campaign);

    const messages: CampaignMessage[] = [];
    await Promise.all(
      campaign.message_ids.map(async (mid) => {
        try {
          const m = await acFetch(creds, `messages/${mid}`);
          if (m.message) {
            messages.push({
              id: String(m.message.id ?? mid),
              subject: m.message.subject ?? "",
              html: m.message.html ?? "",
              fromname: m.message.fromname ?? "",
              fromemail: m.message.fromemail ?? "",
            });
          }
        } catch {
          // skip messages that fail to load
        }
      }),
    );
    return { messages };
  });

// ─── Automation ───────────────────────────────────────────────────────────────

export type Automation = {
  id: string;
  name: string;
  status: string;
  entered: number;
  exited: number;
  active: number;
  completion_rate: number;
  hidden: boolean;
  createdate: string | null;
  mdate: string | null;
};

function mapAutomation(a: any): Automation {
  const entered = Number(a.entered ?? 0);
  const exited = Number(a.exited ?? 0);
  return {
    id: String(a.id),
    name: a.name ?? "(untitled)",
    status: (a.status === 1 || a.status === "1") ? "active" : "inactive",
    entered,
    exited,
    active: Math.max(0, entered - exited),
    completion_rate: entered > 0 ? (exited / entered) * 100 : 0,
    hidden: a.hidden === "1" || a.hidden === true,
    createdate: a.createdate ?? null,
    mdate: a.mdate ?? null,
  };
}

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, "automations", {
      limit: "100",
      orders: "mdate",
      "orders[mdate]": "DESC",
    });
    const automations: Automation[] = (json.automations ?? [])
      .filter((a: any) => a.hidden !== "1" && a.hidden !== true)
      .map(mapAutomation);
    return { automations, total: Number(json.meta?.total ?? automations.length) };
  });

export const getAutomation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, `automations/${data.id}`);
    const automation = mapAutomation(json.automation);
    return { automation };
  });

// ─── Contacts / Influence Analysis ───────────────────────────────────────────

export type ContactField = {
  id: string;
  title: string;
  type: string;
  perstag?: string;
};

export type ContactSummary = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  accountId: string | null;
  fieldValues: Record<string, string>; // contact fieldId → value
};

export const listContactFields = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    // Paginate: accounts with many custom fields push some past the first 100.
    const fields: ContactField[] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const json = await acFetch(creds, "fields", { limit: "100", offset: String(offset) });
      const batch: any[] = json.fields ?? [];
      fields.push(
        ...batch.map((f: any) => ({
          id: String(f.id),
          title: f.title ?? f.perstag ?? `Campo ${f.id}`,
          type: f.type ?? "text",
          perstag: f.perstag ? String(f.perstag) : undefined,
        })),
      );
      if (batch.length < 100) break;
    }
    return { fields };
  });

// Real per-contact "received" proof: ActiveCampaign's public API has no recipient-list
// endpoint for a campaign (filters[campaignid] on /contacts is silently ignored, and
// campaigns/{id}/campaignLists reflects all lists ever linked to the account, not who
// the send actually went to — confirmed against this account's automation-triggered
// campaigns). The open-tracking pixel (the link literally named "open") is the only
// per-contact, per-campaign timestamp the API exposes, so it's used as the "received at".
async function fetchOpenedAt(creds: Settings, campaignId: string): Promise<Record<string, string>> {
    const data = { id: campaignId };
    const openedAt: Record<string, string> = {}; // contactId → earliest open timestamp

    // Primary: legacy API returns the same opens AC shows in its own reports
    try {
      const json = await acLegacyFetch(creds, {
        api_action: "campaign_report_open_list",
        campaignid: data.id,
      });
      if (json?.result_code === 1) {
        for (const key of Object.keys(json)) {
          if (!/^\d+$/.test(key)) continue;
          const entry = json[key];
          const cid = String(entry?.subscriberid ?? "");
          const ts = String(entry?.tstamp ?? "");
          if (!cid || !ts) continue;
          if (!openedAt[cid] || ts < openedAt[cid]) openedAt[cid] = ts;
        }
        return openedAt;
      }
    } catch {
      // fall through to v3 fallback
    }

    // Fallback: v3 tracking-pixel link data
    const linksJson = await acFetch(creds, `campaigns/${data.id}/links`);
    const openLinkIds = ((linksJson.links ?? []) as any[])
      .filter((l) => l.link === "open")
      .map((l) => String(l.id));

    for (const linkId of openLinkIds) {
      let offset = 0;
      for (;;) {
        const json = await acFetch(creds, `links/${linkId}/linkData`, { limit: "100", offset: String(offset) });
        const entries: any[] = json.linkData ?? [];
        for (const e of entries) {
          if (!e.contact || !e.tstamp) continue;
          const cid = String(e.contact);
          if (!openedAt[cid] || e.tstamp < openedAt[cid]) openedAt[cid] = e.tstamp;
        }
        if (entries.length < 100) break;
        offset += 100;
      }
    }
    return openedAt;
}

export const getCampaignOpens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    return { openedAt: await fetchOpenedAt(creds, data.id) };
  });

export const getContactsByIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().min(1).max(32)).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const contacts: ContactSummary[] = [];
    await Promise.all(data.ids.map(async (id) => {
      try {
        const json = await acFetch(creds, `contacts/${id}`, { include: "fieldValues,accountContacts" });
        const c = json.contact;
        if (!c) return;
        const fieldValues: Record<string, string> = {};
        for (const fv of (json.fieldValues ?? []) as any[]) {
          if (fv.field && fv.value != null && fv.value !== "") fieldValues[String(fv.field)] = String(fv.value);
        }
        const accountId = ((json.accountContacts ?? []) as any[])[0]?.account ?? null;
        contacts.push({
          id: String(c.id),
          email: c.email ?? "",
          firstName: c.firstName ?? c.firstname ?? "",
          lastName: c.lastName ?? c.lastname ?? "",
          accountId: accountId ? String(accountId) : null,
          fieldValues,
        });
      } catch {
        // skip contacts that fail to load
      }
    }));
    return { contacts };
  });

// ─── Account custom fields & data ────────────────────────────────────────────

// ─── Automation messages ──────────────────────────────────────────────────────

export type AutomationEmail = CampaignMessage & {
  campaignId: string;
  campaignName: string;
  sends: number;
  uniqueopens: number;
  linkclicks: number;
  uniquelinkclicks: number;
  open_rate: number;
  ctr: number;
};

export const getAutomationMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);

    const json = await acFetch(creds, "campaigns", {
      "filters[automation]": data.id,
      limit: "50",
    });
    const camps: any[] = json.campaigns ?? [];

    const emails: AutomationEmail[] = [];
    for (const c of camps.slice(0, 20)) {
      const mid = c.message_id ?? c.messageid ?? c.message;
      if (!mid || String(mid) === "0") continue;
      try {
        const m = await acFetch(creds, `messages/${String(mid)}`);
        if (!m.message) continue;
        const sends = Number(c.send_amt ?? c.total_amt ?? 0);
        const uo = Number(c.uniqueopens ?? 0);
        const lc = Number(c.linkclicks ?? 0);
        // subscriberclicks = unique clicks per contact, matches AC's own campaign report UI
        const ulc = Number(c.subscriberclicks ?? c.uniquelinkclicks ?? 0);
        emails.push({
          id: String(m.message.id ?? mid),
          campaignId: String(c.id),
          campaignName: c.name ?? "",
          subject: m.message.subject ?? "",
          html: m.message.html ?? "",
          fromname: m.message.fromname ?? "",
          fromemail: m.message.fromemail ?? "",
          sends,
          uniqueopens: uo,
          linkclicks: lc,
          uniquelinkclicks: ulc,
          open_rate: sends > 0 ? (uo / sends) * 100 : 0,
          ctr: sends > 0 ? (ulc / sends) * 100 : 0,
        });
      } catch { /* skip */ }
    }
    return { messages: emails };
  });

// ─── Metric snapshots ─────────────────────────────────────────────────────────

export type MetricSnapshot = {
  id: string;
  label: string;
  entity_type: "campaign" | "automation";
  entity_id: string;
  entity_name: string;
  metrics: Record<string, number | string>;
  created_at: string;
};

export const saveSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      label: z.string().min(1).max(200),
      entity_type: z.enum(["campaign", "automation"]),
      entity_id: z.string().min(1).max(64),
      entity_name: z.string().max(300),
      metrics: z.record(z.union([z.number(), z.string()])),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("metric_snapshots").insert({
      user_id: context.userId,
      label: data.label,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      entity_name: data.entity_name,
      metrics: data.metrics,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ entity_id: z.string().min(1).max(64).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    let q = db.from("metric_snapshots").select("*").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(100);
    if (data.entity_id) q = q.eq("entity_id", data.entity_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { snapshots: (rows ?? []) as MetricSnapshot[] };
  });

export const deleteSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("metric_snapshots").delete().eq("id", data.id).eq("user_id", context.userId);
    return { ok: true };
  });

// ─── Account custom fields & data ────────────────────────────────────────────

export type AccountField = {
  id: string;
  title: string;
  type: string;
};

export type AccountSummary = {
  id: string;
  name: string;
  fieldValues: Record<string, string>; // customFieldId → value
};

export const listAccountFields = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, "accountCustomFieldMeta", { limit: "100" });
    const fields: AccountField[] = (json.accountCustomFieldMeta ?? []).map((f: any) => ({
      id: String(f.id),
      title: f.fieldLabel ?? f.fieldType ?? `Campo ${f.id}`,
      type: f.fieldType ?? "text",
    }));
    return { fields };
  });

export const listAccountsForAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offset: z.number().int().min(0).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, "accounts", {
      limit: "100",
      offset: String(data.offset ?? 0),
      include: "accountCustomFieldData",
    });

    // accountCustomFieldData: separate top-level array
    const fvMap: Record<string, Record<string, string>> = {};
    for (const fv of (json.accountCustomFieldData ?? []) as any[]) {
      if (!fv.accountId || !fv.customFieldId || fv.fieldValue == null || fv.fieldValue === "") continue;
      const aid = String(fv.accountId);
      if (!fvMap[aid]) fvMap[aid] = {};
      fvMap[aid][String(fv.customFieldId)] = String(fv.fieldValue);
    }

    const accounts: AccountSummary[] = (json.accounts ?? []).map((a: any) => ({
      id: String(a.id),
      name: a.name ?? "(sem nome)",
      fieldValues: fvMap[String(a.id)] ?? {},
    }));

    return { accounts, total: Number(json.meta?.total ?? accounts.length) };
  });


// ─── Análises: dados que o ActiveCampaign não consolida sozinho ──────────────

export const listLists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const lists: { id: string; name: string }[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const json = await acFetch(creds, "lists", { limit: "100", offset: String(offset) });
      const batch: any[] = json.lists ?? [];
      lists.push(...batch.map((l) => ({ id: String(l.id), name: String(l.name ?? `Lista ${l.id}`) })));
      if (batch.length < 100) break;
    }
    return { lists };
  });

// Runs `fn` over `items` with at most `limit` in flight (AC rate-limits aggressively).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// Active contacts on a list. Together with the opener history this gives the "dormant base":
// contacts on the list that did not open any of the last N sends. AC has no recipient list
// per campaign, so openers are the only provable signal; Apple Mail Privacy Protection
// auto-opens inflate them, so the real dormant share is at least what is computed here.
export const getListSize = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ listId: z.string().min(1).max(32) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, "contacts", { listid: data.listId, status: "1", limit: "1" });
    return { size: Number(json.meta?.total ?? 0) };
  });

// When the audience actually opens: hour of day and weekday of every first open.
// Hours/weekdays are read straight from the timestamp text (the account's local time),
// so no timezone conversion is applied.
export const getOpenTiming = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(12) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const hours = new Array<number>(24).fill(0);
    const weekdays = new Array<number>(7).fill(0);
    let total = 0;
    let failed = 0;
    await mapLimit(data.ids, 3, async (id) => {
      try {
        const openedAt = await fetchOpenedAt(creds, id);
        for (const ts of Object.values(openedAt)) {
          const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/);
          if (!m) continue;
          hours[+m[4]]++;
          weekdays[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]++;
          total++;
        }
      } catch {
        failed++;
      }
    });
    return { hours, weekdays, total, failed };
  });

export type AccountContactLink = { contactId: string; accountId: string };

export const listAccountContactLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const links: AccountContactLink[] = [];
    let truncated = false;
    for (let offset = 0; ; offset += 100) {
      if (offset >= 10000) {
        truncated = true;
        break;
      }
      const json = await acFetch(creds, "accountContacts", { limit: "100", offset: String(offset) });
      const batch: any[] = json.accountContacts ?? [];
      for (const l of batch) {
        if (l.contact && l.account) links.push({ contactId: String(l.contact), accountId: String(l.account) });
      }
      if (batch.length < 100) break;
    }
    const names: Record<string, string> = {};
    for (let offset = 0; offset < 10000; offset += 100) {
      const json = await acFetch(creds, "accounts", { limit: "100", offset: String(offset) });
      const batch: any[] = json.accounts ?? [];
      for (const a of batch) names[String(a.id)] = String(a.name ?? `Empresa ${a.id}`);
      if (batch.length < 100) break;
    }
    return { links, names, truncated };
  });

// Per-contact open history over several campaigns, newest first.
// Returns for every contact the indexes (0 = newest) of the campaigns they opened.
export const getOpenHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().min(1).max(64)).min(2).max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const opened: Record<string, number[]> = {};
    let failed = 0;
    await mapLimit(data.ids, 3, async (id) => {
      const idx = data.ids.indexOf(id);
      try {
        for (const cid of Object.keys(await fetchOpenedAt(creds, id))) (opened[cid] ??= []).push(idx);
      } catch {
        failed++;
      }
    });
    return { opened, failed };
  });

// Structural features of each e-mail (computed server-side so no HTML is shipped to the browser).
export type EmailFeatures = {
  campaignId: string;
  subject: string;
  subjectLen: number;
  subjectHasEmoji: boolean;
  subjectHasNumber: boolean;
  subjectHasQuestion: boolean;
  subjectPersonalized: boolean;
  words: number;
  links: number;
  images: number;
  firstLinkPos: number; // 0 = top of the e-mail, 1 = bottom
};

function extractFeatures(campaignId: string, subject: string, html: string): EmailFeatures {
  const body = html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ");
  const text = body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const anchors = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].filter(
    (m) => !/unsubscribe|descadastr|optout|opt-out|mailto:|^#/i.test(m[1]),
  );
  return {
    campaignId,
    subject,
    subjectLen: subject.length,
    subjectHasEmoji: /\p{Extended_Pictographic}/u.test(subject),
    subjectHasNumber: /\d/.test(subject),
    subjectHasQuestion: subject.includes("?"),
    subjectPersonalized: /%[A-Z_]+%|\{\{|\{%/.test(subject),
    words: text ? text.split(" ").length : 0,
    links: anchors.length,
    images: (body.match(/<img\b/gi) ?? []).length,
    firstLinkPos: anchors.length > 0 && body.length > 0 ? (anchors[0].index ?? 0) / body.length : 1,
  };
}

export const getEmailFeatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const results = await mapLimit(data.ids, 4, async (id): Promise<EmailFeatures | null> => {
      try {
        const cj = await acFetch(creds, `campaigns/${id}`);
        const mid = mapCampaign(cj.campaign).message_ids[0];
        if (!mid) return null;
        const m = await acFetch(creds, `messages/${mid}`);
        return extractFeatures(id, String(m.message?.subject ?? ""), String(m.message?.html ?? ""));
      } catch {
        return null;
      }
    });
    const features = results.filter((r): r is EmailFeatures => r !== null);
    return { features, failed: data.ids.length - features.length };
  });
