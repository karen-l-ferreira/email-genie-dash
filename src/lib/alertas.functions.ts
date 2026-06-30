import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Settings = { ac_api_key: string; ac_base_url: string };

const AC_HOST_RE = /^[a-z0-9-]+\.(api-[a-z0-9]+\.com|activehosted\.com)$/i;

function assertAllowedAcUrl(u: string): URL {
  const parsed = new URL(u);
  if (parsed.protocol !== "https:" || !AC_HOST_RE.test(parsed.hostname)) {
    throw new Error("INVALID_AC_BASE_URL");
  }
  return parsed;
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
  if (url.protocol !== "https:" || url.hostname !== baseParsed.hostname) {
    throw new Error("INVALID_AC_BASE_URL");
  }
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { "Api-Token": creds.ac_api_key, Accept: "application/json" },
    redirect: "manual",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AC ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Legacy ActiveCampaign API (admin/api.php) — used for per-contact link click data,
// which is not exposed by the v3 REST API.
async function acLegacyFetch(creds: Settings, params: Record<string, string>) {
  const baseParsed = assertAllowedAcUrl(creds.ac_base_url);
  // The legacy admin/api.php endpoint lives at the account root, not under /api/3
  const url = new URL("/admin/api.php", baseParsed.origin);
  if (url.protocol !== "https:" || url.hostname !== baseParsed.hostname) {
    throw new Error("INVALID_AC_BASE_URL");
  }
  url.searchParams.set("api_key", creds.ac_api_key);
  url.searchParams.set("api_output", "json");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { redirect: "manual" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AC legacy ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

const MAX_PAGES = 20;
const PAGE_SIZE = 100;

function parseDateLoose(s: string | undefined): Date | null {
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseMoneyLoose(s: string | undefined | null): number {
  if (!s) return 0;
  const clean = s.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(clean);
  return isNaN(n) ? 0 : n;
}

function isApto(s: string | undefined): boolean {
  if (!s) return false;
  const v = s.trim().toLowerCase();
  return v === "sim" || v === "true" || v === "1" || v === "verdadeiro" || v === "yes";
}

// ─── Contact fields (perstag → fieldId) ────────────────────────────────────

async function loadContactFieldMap(creds: Settings): Promise<Record<string, string>> {
  const json = await acFetch(creds, "fields", { limit: "100" });
  const map: Record<string, string> = {};
  for (const f of (json.fields ?? []) as any[]) {
    if (f.perstag) map[String(f.perstag).toUpperCase()] = String(f.id);
  }
  return map;
}

// ─── Account fields (personalization → fieldId) ────────────────────────────

async function loadAccountFieldMap(creds: Settings): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (let page = 0; page < 5; page++) {
    const json = await acFetch(creds, "accountCustomFieldMeta", {
      limit: "100",
      offset: String(page * 100),
    });
    const fields: any[] = json.accountCustomFieldMeta ?? [];
    for (const f of fields) {
      if (f.personalization) map[String(f.personalization).toUpperCase()] = String(f.id);
    }
    if (fields.length < 100) break;
  }
  return map;
}

// ─── Load all contacts with custom fields ──────────────────────────────────

type ContactData = {
  id: string;
  email: string;
  phone: string;
  accountId: string | null;
  cf: Record<string, string>; // perstag → value
};

async function loadAllContacts(creds: Settings, fieldIdToPerstag: Record<string, string>): Promise<ContactData[]> {
  const out: ContactData[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await acFetch(creds, "contacts", {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      include: "fieldValues,accountContacts",
      "orders[id]": "ASC",
    });

    const cfByContact: Record<string, Record<string, string>> = {};
    for (const fv of (json.fieldValues ?? []) as any[]) {
      if (!fv.contact || !fv.field || fv.value == null || fv.value === "") continue;
      const perstag = fieldIdToPerstag[String(fv.field)];
      if (!perstag) continue;
      (cfByContact[String(fv.contact)] ??= {})[perstag] = String(fv.value);
    }

    const acctByContact: Record<string, string> = {};
    for (const ac of (json.accountContacts ?? []) as any[]) {
      if (ac.contact && ac.account) acctByContact[String(ac.contact)] = String(ac.account);
    }

    for (const c of (json.contacts ?? []) as any[]) {
      out.push({
        id: String(c.id),
        email: c.email ?? "",
        phone: c.phone ?? "",
        accountId: acctByContact[String(c.id)] ?? null,
        cf: cfByContact[String(c.id)] ?? {},
      });
    }
    if ((json.contacts ?? []).length < PAGE_SIZE) break;
  }
  return out;
}

// ─── Load all accounts with custom fields ──────────────────────────────────

type AccountData = {
  id: string;
  name: string;
  cf: Record<string, string>; // personalization → value
};

async function loadAllAccounts(creds: Settings, acctFieldMap: Record<string, string>): Promise<Record<string, AccountData>> {
  // fieldId → personalization (e.g. "42" → "ACCT_VALOR_APROVADO_NO_OPERADO")
  const fieldIdToPersonalization: Record<string, string> = {};
  for (const [personalization, id] of Object.entries(acctFieldMap)) {
    fieldIdToPersonalization[id] = personalization;
  }

  const byId: Record<string, AccountData> = {};

  // Fetch accounts in batches — include custom field data in the same request
  // (same pattern as listAccountsForAnalysis in ac.functions.ts)
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await acFetch(creds, "accounts", {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      include: "accountCustomFieldData",
    });

    // accountCustomFieldData is a top-level array in the response
    // each entry: { accountId, customFieldId, fieldValue }
    const cfByAcct: Record<string, Record<string, string>> = {};
    for (const fv of (json.customerAccountCustomFieldData ?? []) as any[]) {
      const aid = String(fv.customer_account_id ?? fv.customerAccount ?? "");
      const fid = String(fv.custom_field_id ?? fv.customerAccountCustomFieldMetum ?? "");
      if (!aid || !fid) continue;
      const personalization = fieldIdToPersonalization[fid];
      if (!personalization) continue;

      let val: string | null = null;
      if (fv.custom_field_currency_value != null && fv.custom_field_currency_value !== "") {
        // AC stores currency custom field values in cents
        val = String(Number(fv.custom_field_currency_value) / 100);
      } else if (fv.custom_field_number_value != null && fv.custom_field_number_value !== "") {
        val = String(fv.custom_field_number_value);
      } else if (fv.custom_field_text_value != null && fv.custom_field_text_value !== "") {
        val = String(fv.custom_field_text_value);
      }
      if (val == null) continue;

      (cfByAcct[aid] ??= {})[personalization] = val;
    }

    for (const a of (json.accounts ?? []) as any[]) {
      const id = String(a.id);
      byId[id] = { id, name: a.name ?? "", cf: cfByAcct[id] ?? {} };
    }

    if ((json.accounts ?? []).length < PAGE_SIZE) break;
  }

  return byId;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type AlertaClienteRow = {
  contactId: string;
  accountId: string | null;
  razaoSocial: string;
  clienteId: string;
  cnpj: string;
  ultimaOperacao: string | null;
  email: string;
  phone: string;
  valorAprovadoNaoOperado: number;
  limiteDisponivel: number;
  contatado: boolean;
  contatadoEm: string | null;
};

export type ListAlertasResult = {
  rows: AlertaClienteRow[];
  total: number;
  page: number;
  pageSize: number;
};

// ─── Server function ───────────────────────────────────────────────────────

const tabSchema = z.object({
  tab: z.enum(["sem_operar_15", "sem_operar_30", "valor_aprovado"]),
  page: z.number().int().min(1).default(1),
});

export const listAlertasClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => tabSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);

    // Load field maps in parallel
    const [contactFieldMap, acctFieldMap] = await Promise.all([
      loadContactFieldMap(creds),
      loadAccountFieldMap(creds),
    ]);

    // Invert contact field map: fieldId → perstag
    const contactFieldIdToPerstag: Record<string, string> = {};
    for (const [perstag, id] of Object.entries(contactFieldMap)) {
      contactFieldIdToPerstag[id] = perstag;
    }

    // Load contacts, accounts and "já contatado" status in parallel
    const [contacts, accounts, contatadosRows] = await Promise.all([
      loadAllContacts(creds, contactFieldIdToPerstag),
      loadAllAccounts(creds, acctFieldMap),
      context.supabase
        .from("alertas_contatos")
        .select("contact_id, contatado, contatado_em")
        .eq("user_id", context.userId)
        .then((r: any) => r.data ?? []),
    ]);
    const contatadosMap = new Map<string, { contatado: boolean; em: string }>(
      contatadosRows.map((r: any) => [String(r.contact_id), { contatado: r.contatado, em: r.contatado_em }]),
    );

    const now = new Date();
    const cutoff15 = new Date(now.getTime() - 15 * 86400000);
    const cutoff30 = new Date(now.getTime() - 30 * 86400000);

    const contactById = new Map(contacts.map((c) => [c.id, c]));

    let rows: AlertaClienteRow[] = contacts.map((c) => {
      const acct = c.accountId ? accounts[c.accountId] : undefined;
      const acf = acct?.cf ?? {}; // personalization → value

      const dataUlt = parseDateLoose(c.cf["DATA_DA_LTIMA_OPERAO"]);

      // ACCT_VALOR_APROVADO_NO_OPERADO: try contact field first, then account field
      const valorRaw = c.cf["ACCT_VALOR_APROVADO_NO_OPERADO"] ?? acf["ACCT_VALOR_APROVADO_NO_OPERADO"] ?? null;
      const limiteRaw = c.cf["ACCT_LIMITE_DISPONVEL"] ?? acf["ACCT_LIMITE_DISPONVEL"] ?? c.cf["ACCT_LIMITE_DISPONIVEL"] ?? acf["ACCT_LIMITE_DISPONIVEL"] ?? null;

      const razaoSocialRaw = c.cf["RAZO_SOCIAL"] ?? acf["ACCT_RAZO_SOCIAL"] ?? null;

      return {
        contactId: c.id,
        accountId: c.accountId,
        razaoSocial: razaoSocialRaw ?? acct?.name ?? "",
        clienteId: acf["ACCT_CLIENTE_ID"] ?? c.cf["ACCT_CLIENTE_ID"] ?? "",
        cnpj: acf["ACCT_CNPJ"] ?? c.cf["ACCT_CNPJ"] ?? "",
        ultimaOperacao: dataUlt ? dataUlt.toISOString() : null,
        email: c.email,
        phone: c.phone,
        valorAprovadoNaoOperado: parseMoneyLoose(valorRaw),
        limiteDisponivel: parseMoneyLoose(limiteRaw),
        contatado: contatadosMap.get(c.id)?.contatado ?? false,
        contatadoEm: contatadosMap.get(c.id)?.em ?? null,
      };
    });

    if (data.tab === "sem_operar_15") {
      rows = rows.filter((r) => {
        const c = contactById.get(r.contactId);
        if (!isApto(c?.cf["APTO"])) return false;
        if (!r.ultimaOperacao) return false;
        const d = new Date(r.ultimaOperacao);
        return d < cutoff15 && d >= cutoff30;
      });
      rows.sort((a, b) => (a.ultimaOperacao! < b.ultimaOperacao! ? -1 : 1));
    } else if (data.tab === "sem_operar_30") {
      rows = rows.filter((r) => {
        const c = contactById.get(r.contactId);
        if (!isApto(c?.cf["APTO"])) return false;
        if (!r.ultimaOperacao) return false;
        return new Date(r.ultimaOperacao) < cutoff30;
      });
      rows.sort((a, b) => (a.ultimaOperacao! < b.ultimaOperacao! ? -1 : 1));
    } else if (data.tab === "valor_aprovado") {
      rows = rows.filter((r) => {
        const c = contactById.get(r.contactId);
        return isApto(c?.cf["APTO"]) && r.valorAprovadoNaoOperado > 5000;
      });
      rows.sort((a, b) => b.valorAprovadoNaoOperado - a.valorAprovadoNaoOperado);
    }

    const pageSize = 20;
    const total = rows.length;
    const start = (data.page - 1) * pageSize;
    return {
      rows: rows.slice(start, start + pageSize),
      total,
      page: data.page,
      pageSize,
    } satisfies ListAlertasResult;
  });

export const toggleAlertaContatado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      contactId: z.string().min(1),
      contatado: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    if (data.contatado) {
      const { error } = await db
        .from("alertas_contatos")
        .upsert(
          { user_id: context.userId, contact_id: data.contactId, contatado: true, contatado_em: new Date().toISOString() },
          { onConflict: "user_id,contact_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("alertas_contatos")
        .delete()
        .eq("user_id", context.userId)
        .eq("contact_id", data.contactId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ─── Cliques em links de WhatsApp/Portal dentro de e-mails enviados ────────

const WHATSAPP_LINK_RE = /wa\.me|api\.whatsapp\.com/i;
const PORTAL_LINK_RE = /portal\.adiantesa\.com/i;

export type CliqueInfo = {
  contactId: string;
  email: string;
  clicadoEm: string; // ISO
  razaoSocial: string;
  clienteId: string;
  cnpj: string;
};

export type CampanhaCliquesRow = {
  campanhaId: string;
  campanhaNome: string;
  sdate: string; // ISO
  whatsapp: CliqueInfo[];
  portal: CliqueInfo[];
};

export type ListCliquesResult = {
  campanhas: CampanhaCliquesRow[];
  total: number;
  page: number;
  pageSize: number;
  campanhasEscaneadas: number;
  campanhasComErro: number;
};

const MAX_CAMPAIGNS = 40;

export const listCliquesAlertas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ page: z.number().int().min(1).default(1) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const cutoffStart = new Date(Date.now() - 60 * 86400000);

    // Kick off contact/account enrichment lookup in parallel with the campaign scan below
    const enrichPromise = (async () => {
      const [contactFieldMap, acctFieldMap] = await Promise.all([
        loadContactFieldMap(creds),
        loadAccountFieldMap(creds),
      ]);
      const contactFieldIdToPerstag: Record<string, string> = {};
      for (const [perstag, id] of Object.entries(contactFieldMap)) contactFieldIdToPerstag[id] = perstag;
      const [contacts, accounts] = await Promise.all([
        loadAllContacts(creds, contactFieldIdToPerstag),
        loadAllAccounts(creds, acctFieldMap),
      ]);
      const map = new Map<string, { razaoSocial: string; clienteId: string; cnpj: string }>();
      for (const c of contacts) {
        const acct = c.accountId ? accounts[c.accountId] : undefined;
        const acf = acct?.cf ?? {};
        const razaoSocialRaw = c.cf["RAZO_SOCIAL"] ?? acf["ACCT_RAZO_SOCIAL"] ?? null;
        map.set(c.id, {
          razaoSocial: razaoSocialRaw ?? acct?.name ?? "",
          clienteId: acf["ACCT_CLIENTE_ID"] ?? c.cf["ACCT_CLIENTE_ID"] ?? "",
          cnpj: acf["ACCT_CNPJ"] ?? c.cf["ACCT_CNPJ"] ?? "",
        });
      }
      return map;
    })();

    // 1. Load recently sent campaigns (newest first)
    type CampaignMeta = { id: string; name: string; sdate: Date };
    const campaigns: CampaignMeta[] = [];
    for (let page = 0; page < 10; page++) {
      const json = await acFetch(creds, "campaigns", {
        limit: "100",
        offset: String(page * 100),
        "orders[sdate]": "DESC",
      });
      const rows: any[] = json.campaigns ?? [];
      for (const c of rows) {
        if (!c.sdate || String(c.sdate).startsWith("0000")) continue;
        const sdate = new Date(c.sdate);
        if (isNaN(sdate.getTime())) continue;
        if (sdate >= cutoffStart) campaigns.push({ id: String(c.id), name: c.name ?? "(sem nome)", sdate });
      }
      const last = rows[rows.length - 1];
      const lastDate = last?.sdate && !String(last.sdate).startsWith("0000") ? new Date(last.sdate) : null;
      if (rows.length < 100 || (lastDate && lastDate < cutoffStart)) break;
      if (campaigns.length >= MAX_CAMPAIGNS) break;
    }

    const targetCampaigns = campaigns.slice(0, MAX_CAMPAIGNS);

    // 2. For each campaign, fetch per-link click data via the legacy API and
    // keep only clicks on WhatsApp/Portal links
    const campanhasOut: CampanhaCliquesRow[] = [];
    let campanhasComErro = 0;
    let firstError: string | null = null;

    for (const camp of targetCampaigns) {
      let json: any;
      try {
        json = await acLegacyFetch(creds, { api_action: "campaign_report_link_list", campaignid: camp.id });
      } catch (e) {
        campanhasComErro++;
        if (!firstError) firstError = (e as Error).message;
        continue;
      }
      if (json?.result_code === 0) {
        campanhasComErro++;
        if (!firstError) firstError = `result_code=0: ${json?.result_message ?? "sem mensagem"}`;
        continue;
      }

      const whatsapp: CliqueInfo[] = [];
      const portal: CliqueInfo[] = [];
      for (const key of Object.keys(json)) {
        if (!/^\d+$/.test(key)) continue;
        const linkEntry = json[key];
        const url = String(linkEntry?.link ?? "");
        const tipo: "whatsapp" | "portal" | null = WHATSAPP_LINK_RE.test(url)
          ? "whatsapp"
          : PORTAL_LINK_RE.test(url)
          ? "portal"
          : null;
        if (!tipo) continue;
        const infos: any[] = Array.isArray(linkEntry?.info) ? linkEntry.info : [];
        for (const info of infos) {
          const tstamp = info?.tstamp ? new Date(String(info.tstamp).replace(" ", "T")) : null;
          const entry: CliqueInfo = {
            contactId: String(info?.subscriberid ?? ""),
            email: info?.email ?? "",
            clicadoEm: tstamp && !isNaN(tstamp.getTime()) ? tstamp.toISOString() : camp.sdate.toISOString(),
            razaoSocial: "",
            clienteId: "",
            cnpj: "",
          };
          (tipo === "whatsapp" ? whatsapp : portal).push(entry);
        }
      }

      if (whatsapp.length > 0 || portal.length > 0) {
        campanhasOut.push({ campanhaId: camp.id, campanhaNome: camp.name, sdate: camp.sdate.toISOString(), whatsapp, portal });
      }
    }

    if (campanhasOut.length === 0 && campanhasComErro === targetCampaigns.length && targetCampaigns.length > 0) {
      throw new Error(`Falha ao consultar a API legada do AC em todas as ${targetCampaigns.length} campanhas. Erro: ${firstError}`);
    }

    // Enrich each click with razão social / CNPJ / cliente ID
    const enrichMap = await enrichPromise;
    for (const camp of campanhasOut) {
      for (const entry of [...camp.whatsapp, ...camp.portal]) {
        const info = enrichMap.get(entry.contactId);
        if (info) {
          entry.razaoSocial = info.razaoSocial;
          entry.clienteId = info.clienteId;
          entry.cnpj = info.cnpj;
        }
      }
    }

    campanhasOut.sort((a, b) => (a.sdate < b.sdate ? 1 : -1));

    const pageSize = 10;
    const total = campanhasOut.length;
    const start = (data.page - 1) * pageSize;
    return {
      campanhas: campanhasOut.slice(start, start + pageSize),
      total,
      page: data.page,
      pageSize,
      campanhasEscaneadas: targetCampaigns.length,
      campanhasComErro,
    } satisfies ListCliquesResult;
  });
