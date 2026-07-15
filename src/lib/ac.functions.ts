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

async function getCreds(supabase: any, userId: string): Promise<Settings> {
  const { data } = await supabase
    .from("user_settings")
    .select("ac_api_key, ac_base_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.ac_api_key) throw new Error("MISSING_API_KEY");
  return { ac_api_key: data.ac_api_key, ac_base_url: data.ac_base_url };
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
  const ulc = Number(c.uniquelinkclicks ?? 0);
  const open_rate = send > 0 ? (uo / send) * 100 : 0;
  const ctr = uo > 0 ? (ulc / uo) * 100 : 0;
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

export const listCobrancaHoje = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Acha campanhas de cobrança (ldate = hoje = rodaram hoje às 9h)
    const allCampaigns: Campaign[] = [];
    for (let page = 0; page < 5; page++) {
      const json = await acFetch(creds, "campaigns", {
        limit: "100",
        offset: String(page * 100),
        orders: "ldate",
        "orders[ldate]": "DESC",
      });
      const batch: Campaign[] = (json.campaigns ?? []).map(mapCampaign);
      if (batch.length === 0) break;
      const deHoje = batch.filter((c) => (c.ldate ?? "").startsWith(today));
      allCampaigns.push(...deHoje);
      if ((batch[batch.length - 1]?.ldate ?? "").slice(0, 10) < today) break;
    }

    const billing = allCampaigns.filter((c) => {
      const n = c.name.toLowerCase();
      return n.includes("vencimento") || n.includes("vencido") || /^d[+-]\d+$/i.test(c.name.trim());
    });

    // 2. Testa campaignreports v3 (auth diferente da legacy)
    let debugRaw: any = null;
    if (billing.length > 0) {
      const sample = billing[0];
      try {
        const report = await acFetch(creds, `campaignreports/${sample.id}`);
        debugRaw = { endpoint: `campaignreports/${sample.id}`, name: sample.name, keys: Object.keys(report).slice(0, 20), data: report };
      } catch (e) {
        debugRaw = { error: String(e) };
      }
    }

    return { campaigns: billing, today, debugRaw };
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
    const json = await acFetch(creds, "fields", { limit: "100" });
    const fields: ContactField[] = (json.fields ?? []).map((f: any) => ({
      id: String(f.id),
      title: f.title ?? f.perstag ?? `Campo ${f.id}`,
      type: f.type ?? "text",
    }));
    return { fields };
  });

// Real per-contact "received" proof: ActiveCampaign's public API has no recipient-list
// endpoint for a campaign (filters[campaignid] on /contacts is silently ignored, and
// campaigns/{id}/campaignLists reflects all lists ever linked to the account, not who
// the send actually went to — confirmed against this account's automation-triggered
// campaigns). The open-tracking pixel (the link literally named "open") is the only
// per-contact, per-campaign timestamp the API exposes, so it's used as the "received at".
export const getCampaignOpens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
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
        return { openedAt };
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
    return { openedAt };
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

    // Log all click/open related fields from first campaign to find correct mapping
    if (camps.length > 0) {
      const f = camps[0];
      const clickFields: Record<string, any> = {};
      for (const k of Object.keys(f)) {
        if (/click|open|link|unique|subscriber|forward/i.test(k)) {
          clickFields[k] = f[k];
        }
      }
      console.error("[AC_FIELDS]", JSON.stringify(clickFields));
    }

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
        const ulc = Number(c.uniquelinkclicks ?? 0);
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
          ctr: uo > 0 ? (ulc / uo) * 100 : 0,
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

// ─── Cobrança comparison ──────────────────────────────────────────────────────

// Exact automation names from ActiveCampaign + which account field day they correspond to
// fieldDay: the number parsed from the account field label (D-7→-7, D0→0, D1→1, D7→7…)
// IDs diretos do AC — evita lookup por nome que pode falhar por diferença de caracteres
const REGUA_DEFS: { id: string; name: string; type: "cedente" | "sacado"; label: string; fieldDay: number; fieldTag: string }[] = [
  // Cedente
  { id: "41",  name: "[Cobrança - Cedente] 7 Dias Vencimento",        type: "cedente", label: "D-7",  fieldDay: -7, fieldTag: "ACCT_COBRANA_CEDENTE_D7_QTD"  },
  { id: "49",  name: "[Cobrança - Cedente] Padrão Amanhã Vencimento", type: "cedente", label: "D-1",  fieldDay: -1, fieldTag: "ACCT_COBRANA_CEDENTE_D1_QTD"  },
  { id: "50",  name: "[Cobrança - Cedente] Padrão Hoje Vencimento",   type: "cedente", label: "D0",   fieldDay:  0, fieldTag: "ACCT_COBRANA_CEDENTE_D0_QTD"  },
  { id: "19",  name: "[Cobrança - Cedente] Ontem Vencimento",         type: "cedente", label: "D+1",  fieldDay:  1, fieldTag: "ACCT_COBRANA_CEDENTE_D1P_QTD" },
  { id: "44",  name: "[Cobrança - Cedente] D+3 Vencimento",           type: "cedente", label: "D+3",  fieldDay:  3, fieldTag: "ACCT_COBRANA_CEDENTE_D3_QTD"  },
  { id: "140", name: "[Cobrança - Cedente] D+5 Vencimento",           type: "cedente", label: "D+5",  fieldDay:  5, fieldTag: "ACCT_COBRANA_CEDENTE_D5_QTD"  },
  { id: "141", name: "[Cobrança - Cedente] D+9 Vencimento",           type: "cedente", label: "D+9",  fieldDay:  9, fieldTag: "ACCT_COBRANA_CEDENTE_D9_QTD"  },
  { id: "142", name: "[Cobrança - Cedente] D+10 Vencimento",          type: "cedente", label: "D+10", fieldDay: 10, fieldTag: "ACCT_COBRANA_CEDENTE_D10_QTD" },
  { id: "143", name: "[Cobrança - Cedente] D+12 Vencimento",          type: "cedente", label: "D+12", fieldDay: 12, fieldTag: "ACCT_COBRANA_CEDENTE_D12_QTD" },
  { id: "144", name: "[Cobrança - Cedente] D+15 Vencimento",          type: "cedente", label: "D+15", fieldDay: 15, fieldTag: "ACCT_COBRANA_CEDENTE_D15_QTD" },
  { id: "145", name: "[Cobrança - Cedente] D+31",                     type: "cedente", label: "D+31", fieldDay: 31, fieldTag: "ACCT_COBRANA_CEDENTE_D31_QTD" },
  // Sacado
  { id: "67",  name: "[Cobrança - Sacado] Padrão Amanhã Vencimento",  type: "sacado",  label: "D-1",  fieldDay: -1, fieldTag: "ACCT_COBRANA_SACADO_D1_QTD"  },
  { id: "70",  name: "[Cobrança - Sacado] Padrão Hoje Vencimento",    type: "sacado",  label: "D0",   fieldDay:  0, fieldTag: "ACCT_COBRANA_SACADO_D0_QTD"  },
  { id: "155", name: "[Cobrança - Sacado] Ontem Vencimento",          type: "sacado",  label: "D+1",  fieldDay:  1, fieldTag: "ACCT_COBRANA_SACADO_D1P_QTD" },
  { id: "154", name: "[Cobrança - Sacado] D+3 Vencimento",            type: "sacado",  label: "D+3",  fieldDay:  3, fieldTag: "ACCT_COBRANA_SACADO_D3_QTD"  },
  { id: "156", name: "[Cobrança - Sacado] D+4 Vencimento",            type: "sacado",  label: "D+4",  fieldDay:  4, fieldTag: "ACCT_COBRANA_SACADO_D4_QTD"  },
  { id: "157", name: "[Cobrança - Sacado] D+5 Vencimento",            type: "sacado",  label: "D+5",  fieldDay:  5, fieldTag: "ACCT_COBRANA_SACADO_D5_QTD"  },
  { id: "158", name: "[Cobrança - Sacado] D+9 Vencimento",            type: "sacado",  label: "D+9",  fieldDay:  9, fieldTag: "ACCT_COBRANA_SACADO_D9_QTD"  },
  { id: "159", name: "[Cobrança - Sacado] D+12 Vencimento",           type: "sacado",  label: "D+12", fieldDay: 12, fieldTag: "ACCT_COBRANA_SACADO_D12_QTD" },
  { id: "160", name: "[Cobrança - Sacado] D+15 Vencimento",           type: "sacado",  label: "D+15", fieldDay: 15, fieldTag: "ACCT_COBRANA_SACADO_D15_QTD" },
];

export type CobrancaRow = {
  label: string;
  fieldDay: number;
  type: "cedente" | "sacado";
  automation_name: string;
  automation_id: string | null;
  enviados: number;
  elegiveis: number;
};

function dayLabel(d: number) {
  if (d < 0) return `D${d}`;
  if (d === 0) return "D0";
  return `D+${d}`;
}

export const debugCobrancaNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);

    // All automation names
    let allAutos: any[] = [];
    for (let page = 0; page < 5; page++) {
      const j = await acFetch(creds, "automations", { limit: "100", offset: String(page * 100) });
      const batch = j.automations ?? [];
      allAutos = allAutos.concat(batch);
      if (batch.length < 100) break;
    }
    const autoNames = allAutos.map((a: any) => ({ id: String(a.id), name: String(a.name ?? "") }));

    // All account custom field labels
    const fieldsJson = await acFetch(creds, "accountCustomFieldMeta", { limit: "200" });
    const fieldLabels = (fieldsJson.accountCustomFieldMeta ?? []).map((f: any) => ({
      id: String(f.id),
      label: String(f.fieldLabel ?? ""),
    }));

    return { autoNames, fieldLabels };
  });

export const getCobrancaComparison = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const today = new Date().toISOString().slice(0, 10);

    // ── 1. Busca envios de hoje por automação (ID hardcoded) ─────────────────
    const sendsMap: Record<string, number> = {};

    await Promise.all(REGUA_DEFS.map(async (def) => {
      try {
        const j = await acFetch(creds, "campaigns", {
          "filters[seriesid]": def.id,
          limit: "100",
        });
        const camps: any[] = j.campaigns ?? [];
        const enviados = camps
          .filter((c: any) => (c.ldate ?? "").startsWith(today))
          .reduce((sum: number, c: any) => sum + parseInt(c.send_amt ?? "0", 10), 0);
        sendsMap[def.id] = enviados;
      } catch { sendsMap[def.id] = 0; }
    }));

    // ── 2. Busca campos de conta e mapeia perstag → fieldId ─────────────────
    const fieldsJson = await acFetch(creds, "accountCustomFieldMeta", { limit: "200" });
    // Monta lookup: perstag (ex: "ACCT_COBRANA_CEDENTE_D7_QTD") → customFieldId
    const tagToFieldId: Record<string, string> = {};
    for (const f of (fieldsJson.accountCustomFieldMeta ?? []) as any[]) {
      if (f.fieldType !== undefined && f.perstag) {
        tagToFieldId[String(f.perstag)] = String(f.id);
      }
      // Alguns campos expõem o perstag no próprio objeto, outros no fieldLabel
      if (f.fieldLabel) {
        // Fallback: tenta pelo label também via regex
        const lbl: string = f.fieldLabel ?? "";
        const m = lbl.match(/Cobran[çc]a\s+(Sacado|Cedente)\s+D([+-]?\d+)\s*[-–]\s*Qtd/i);
        if (m) {
          const tipo = m[1].toLowerCase();
          const dia = parseInt(m[2]);
          // Marca no mapa por tipo+dia
          const key = `${tipo}_${dia}`;
          tagToFieldId[`__label__${key}`] = String(f.id);
        }
      }
    }

    // Resolve fieldId para cada régua (perstag direto ou fallback por label)
    function resolveFieldId(def: typeof REGUA_DEFS[0]): string | null {
      // Tenta perstag direto
      if (tagToFieldId[def.fieldTag]) return tagToFieldId[def.fieldTag];
      // Fallback por label
      const key = `${def.type}_${def.fieldDay}`;
      return tagToFieldId[`__label__${key}`] ?? null;
    }

    // ── 3. Pagina todas as contas e conta elegíveis ──────────────────────────
    const eligible: Record<string, number> = {}; // defId → count

    let offset = 0;
    let totalAccounts = Infinity;
    while (offset < totalAccounts) {
      const json = await acFetch(creds, "accounts", {
        limit: "100",
        offset: String(offset),
        include: "accountCustomFieldData",
      });
      totalAccounts = Number(json.meta?.total ?? 0);
      const accounts: any[] = json.accounts ?? [];
      if (accounts.length === 0) break;

      // Monta fvMap: accountId → { fieldId → value }
      const fvMap: Record<string, Record<string, number>> = {};
      for (const fv of (json.accountCustomFieldData ?? []) as any[]) {
        if (!fv.accountId || !fv.customFieldId || !fv.fieldValue) continue;
        const val = parseFloat(fv.fieldValue);
        if (!val || val <= 0) continue;
        const aid = String(fv.accountId);
        if (!fvMap[aid]) fvMap[aid] = {};
        fvMap[aid][String(fv.customFieldId)] = val;
      }

      for (const acct of accounts) {
        const fvs = fvMap[String(acct.id)] ?? {};
        for (const def of REGUA_DEFS) {
          const fieldId = resolveFieldId(def);
          if (!fieldId) continue;
          if ((fvs[fieldId] ?? 0) > 0) {
            eligible[def.id] = (eligible[def.id] ?? 0) + 1;
          }
        }
      }

      offset += accounts.length;
      if (offset >= totalAccounts) break;
    }

    // ── 4. Monta rows ────────────────────────────────────────────────────────
    const rows: CobrancaRow[] = REGUA_DEFS.map((def) => ({
      label: def.label,
      fieldDay: def.fieldDay,
      type: def.type,
      automation_name: def.name,
      automation_id: def.id,
      enviados: sendsMap[def.id] ?? 0,
      elegiveis: eligible[def.id] ?? 0,
    }));

    return { rows, today, fetchedAt: new Date().toISOString() };
  });
