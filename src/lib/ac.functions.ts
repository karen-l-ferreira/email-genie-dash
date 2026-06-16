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
    status: a.status ?? "draft",
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

export const listContactsForAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offset: z.number().int().min(0).optional(), listId: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const params: Record<string, string> = {
      limit: "100",
      offset: String(data.offset ?? 0),
      include: "fieldValues,accountContacts",
      "orders[id]": "DESC",
    };
    if (data.listId) params["listid"] = data.listId;
    const json = await acFetch(creds, "contacts", params);

    // fieldValues: separate top-level array keyed by contact id
    const fvMap: Record<string, Record<string, string>> = {};
    for (const fv of (json.fieldValues ?? []) as any[]) {
      if (!fv.contact || !fv.field || fv.value == null || fv.value === "") continue;
      const cid = String(fv.contact);
      if (!fvMap[cid]) fvMap[cid] = {};
      fvMap[cid][String(fv.field)] = String(fv.value);
    }

    // accountContacts: array of {contact, account} links
    const acctMap: Record<string, string> = {}; // contactId → accountId
    for (const ac of (json.accountContacts ?? []) as any[]) {
      if (ac.contact && ac.account) {
        acctMap[String(ac.contact)] = String(ac.account);
      }
    }

    const contacts: ContactSummary[] = (json.contacts ?? []).map((c: any) => ({
      id: String(c.id),
      email: c.email ?? "",
      firstName: c.firstName ?? c.firstname ?? "",
      lastName: c.lastName ?? c.lastname ?? "",
      accountId: acctMap[String(c.id)] ?? null,
      fieldValues: fvMap[String(c.id)] ?? {},
    }));

    return { contacts, total: Number(json.meta?.total ?? contacts.length) };
  });

// ─── Account custom fields & data ────────────────────────────────────────────

// ─── Automation messages ──────────────────────────────────────────────────────

export const getAutomationMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);

    // Fetch campaigns filtered by automation. AC uses "filters[automation]" in the URL.
    // We also filter in code as a safety net using all known field names.
    const json = await acFetch(creds, "campaigns", {
      "filters[automation]": data.id,
      limit: "50",
    });
    const camps: any[] = (json.campaigns ?? []).filter((c: any) =>
      String(c.automation ?? c.series ?? c.seriesid ?? "") === data.id
    );

    const msgIds = [...new Set(
      camps.map((c: any) => c.message_id ? String(c.message_id) : null).filter(Boolean) as string[]
    )];

    // Fetch at most 20 messages to avoid timeout
    const limited = msgIds.slice(0, 20);
    const messages: CampaignMessage[] = [];
    for (const mid of limited) {
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
      } catch { /* skip */ }
    }
    return { messages };
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
