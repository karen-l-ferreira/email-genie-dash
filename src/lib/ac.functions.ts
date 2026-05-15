import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Settings = { ac_api_key: string; ac_base_url: string };

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
  const base = creds.ac_base_url.endsWith("/") ? creds.ac_base_url : creds.ac_base_url + "/";
  const url = new URL(path.replace(/^\//, ""), base);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { "Api-Token": creds.ac_api_key, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ActiveCampaign ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

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
  message_id: string | null;
  open_rate: number;
  ctr: number;
  score: number;
};

function mapCampaign(c: any): Campaign {
  const send = Number(c.send_amt ?? c.total_amt ?? 0);
  const uo = Number(c.uniqueopens ?? 0);
  const ulc = Number(c.uniquelinkclicks ?? 0);
  const open_rate = send > 0 ? (uo / send) * 100 : 0;
  const ctr = uo > 0 ? (ulc / uo) * 100 : 0;
  const score = Math.min(100, Math.round(open_rate * 2 + ctr * 8));
  const messageId = c.relmessages?.[0] ?? c.message_id ?? null;
  return {
    id: String(c.id),
    name: c.name ?? "(untitled)",
    status: String(c.status ?? "0"),
    type: c.type ?? "single",
    sdate: c.sdate ?? null,
    ldate: c.ldate ?? null,
    send_amt: send,
    total_amt: Number(c.total_amt ?? 0),
    opens: Number(c.opens ?? 0),
    uniqueopens: uo,
    linkclicks: Number(c.linkclicks ?? 0),
    uniquelinkclicks: ulc,
    hardbounces: Number(c.hardbounces ?? 0),
    softbounces: Number(c.softbounces ?? 0),
    unsubscribes: Number(c.unsubscribes ?? 0),
    message_id: messageId ? String(messageId) : null,
    open_rate,
    ctr,
    score,
  };
}

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const json = await acFetch(creds, "campaigns", {
      limit: "100",
      orders: "sdate",
      "orders[sdate]": "DESC",
    });
    const campaigns: Campaign[] = (json.campaigns ?? []).map(mapCampaign);
    return { campaigns };
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
    if (campaign.message_id) {
      try {
        const m = await acFetch(creds, `messages/${campaign.message_id}`);
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