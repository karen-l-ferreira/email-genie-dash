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

    // Load contacts and accounts in parallel
    const [contacts, accounts] = await Promise.all([
      loadAllContacts(creds, contactFieldIdToPerstag),
      loadAllAccounts(creds, acctFieldMap),
    ]);

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

      return {
        contactId: c.id,
        accountId: c.accountId,
        razaoSocial: acf["RAZAO_SOCIAL"] ?? acct?.name ?? "",
        clienteId: acf["ACCT_CLIENTE_ID"] ?? c.cf["ACCT_CLIENTE_ID"] ?? "",
        cnpj: acf["ACCT_CNPJ"] ?? c.cf["ACCT_CNPJ"] ?? "",
        ultimaOperacao: dataUlt ? dataUlt.toISOString() : null,
        email: c.email,
        phone: c.phone,
        valorAprovadoNaoOperado: parseMoneyLoose(valorRaw),
        limiteDisponivel: parseMoneyLoose(limiteRaw),
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

// ─── Alertas enviados ───────────────────────────────────────────────────────

export type AlertaEnviadoRow = {
  id: string;
  cliente_id: string;
  cliente_nome: string | null;
  email_destino: string;
  data_envio: string;
  link_whatsapp_clicado: string | null;
  link_portal_clicado: string | null;
};

export const listAlertasEnviados = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      page: z.number().int().min(1).default(1),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const pageSize = 20;
    let q = db
      .from("alertas_enviados")
      .select("id, cliente_id, cliente_nome, email_destino, data_envio, link_whatsapp_clicado, link_portal_clicado", { count: "exact" })
      .eq("user_id", context.userId)
      .order("data_envio", { ascending: false });
    if (data.dataInicio) q = q.gte("data_envio", data.dataInicio);
    if (data.dataFim) q = q.lte("data_envio", data.dataFim);
    const from = (data.page - 1) * pageSize;
    q = q.range(from, from + pageSize - 1);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []) as AlertaEnviadoRow[],
      total: count ?? 0,
      page: data.page,
      pageSize,
    };
  });
