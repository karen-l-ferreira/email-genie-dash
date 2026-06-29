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

// Cap to keep requests bounded — 20 pages of 100 = 2000 records.
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

type ContactRow = {
  id: string;
  email: string;
  phone: string;
  accountId: string | null;
  cf: Record<string, string>; // perstag → value
};

type AccountRow = {
  id: string;
  name: string;
  cf: Record<string, string>; // perstag (e.g. ACCT_CNPJ) → value
};

async function loadContactFieldsByPerstag(creds: Settings): Promise<Record<string, string>> {
  const json = await acFetch(creds, "fields", { limit: "100" });
  const map: Record<string, string> = {};
  for (const f of (json.fields ?? []) as any[]) {
    if (f.perstag) map[String(f.perstag).toUpperCase()] = String(f.id);
  }
  return map;
}

function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/gi, "_")
    .toUpperCase();
}

// Returns map of fieldId → all tags (perstag + normalized label) for that field
// Returns map of fieldId → all tags for that field (personalization + normalized label)
async function loadAccountFieldsById(creds: Settings): Promise<Record<string, string[]>> {
  const json = await acFetch(creds, "accountCustomFieldMeta", { limit: "100" });
  const map: Record<string, string[]> = {};
  for (const f of (json.accountCustomFieldMeta ?? []) as any[]) {
    const id = String(f.id);
    const tags: string[] = [];
    if (f.personalization) tags.push(String(f.personalization).toUpperCase());
    if (f.fieldLabel) tags.push(normalizeKey(f.fieldLabel));
    if (tags.length) map[id] = tags;
  }
  return map;
}

async function loadAllContacts(creds: Settings, perstagToId: Record<string, string>): Promise<ContactRow[]> {
  const idToPerstag: Record<string, string> = {};
  for (const [k, v] of Object.entries(perstagToId)) idToPerstag[v] = k;

  const out: ContactRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await acFetch(creds, "contacts", {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      include: "fieldValues,accountContacts",
      "orders[id]": "ASC",
    });
    const fvByContact: Record<string, Record<string, string>> = {};
    for (const fv of (json.fieldValues ?? []) as any[]) {
      if (!fv.contact || !fv.field || fv.value == null || fv.value === "") continue;
      const cid = String(fv.contact);
      const tag = idToPerstag[String(fv.field)];
      if (!tag) continue;
      (fvByContact[cid] ??= {})[tag] = String(fv.value);
    }
    const acctByContact: Record<string, string> = {};
    for (const ac of (json.accountContacts ?? []) as any[]) {
      if (ac.contact && ac.account) acctByContact[String(ac.contact)] = String(ac.account);
    }
    const rows: any[] = json.contacts ?? [];
    for (const c of rows) {
      out.push({
        id: String(c.id),
        email: c.email ?? "",
        phone: c.phone ?? "",
        accountId: acctByContact[String(c.id)] ?? null,
        cf: fvByContact[String(c.id)] ?? {},
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function loadAllAccounts(creds: Settings, fieldIdToTags: Record<string, string[]>): Promise<Record<string, AccountRow>> {
  const byId: Record<string, AccountRow> = {};
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await acFetch(creds, "accounts", {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      include: "accountCustomFieldData",
    });
    const fvByAcct: Record<string, Record<string, string>> = {};
    for (const fv of (json.accountCustomFieldData ?? []) as any[]) {
      if (!fv.accountId || !fv.customFieldId || fv.fieldValue == null || fv.fieldValue === "") continue;
      const aid = String(fv.accountId);
      const tags = fieldIdToTags[String(fv.customFieldId)] ?? [];
      for (const tag of tags) {
        (fvByAcct[aid] ??= {})[tag] = String(fv.fieldValue);
      }
    }
    const rows: any[] = json.accounts ?? [];
    for (const a of rows) {
      const id = String(a.id);
      byId[id] = { id, name: a.name ?? "", cf: fvByAcct[id] ?? {} };
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return byId;
}

function parseDateLoose(s: string | undefined): Date | null {
  if (!s) return null;
  // Try ISO/standard first
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // dd/mm/yyyy
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseMoneyLoose(s: string | undefined): number {
  if (!s) return 0;
  // Strip currency, allow dot/comma decimal
  const clean = s.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(clean);
  return isNaN(n) ? 0 : n;
}

function isApto(s: string | undefined): boolean {
  if (!s) return false;
  const v = s.trim().toLowerCase();
  return v === "sim" || v === "true" || v === "1" || v === "verdadeiro" || v === "yes";
}

export type AlertaClienteRow = {
  contactId: string;
  accountId: string | null;
  razaoSocial: string;
  clienteId: string;
  cnpj: string;
  ultimaOperacao: string | null; // ISO
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
  _debug?: { acctFieldKeys: string[]; sampleAcf: Record<string, string> } | null;
};

const tabSchema = z.object({
  tab: z.enum(["sem_operar_15", "sem_operar_30", "valor_aprovado"]),
  page: z.number().int().min(1).default(1),
});

export const listAlertasClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => tabSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const [contactPerstag, accountFieldsById] = await Promise.all([
      loadContactFieldsByPerstag(creds),
      loadAccountFieldsById(creds),
    ]);
    const [contacts, accounts] = await Promise.all([
      loadAllContacts(creds, contactPerstag),
      loadAllAccounts(creds, accountFieldsById),
    ]);

    const now = new Date();
    const cutoff15 = new Date(now.getTime() - 15 * 86400000);
    const cutoff30 = new Date(now.getTime() - 30 * 86400000);

    let rows: AlertaClienteRow[] = contacts.map((c) => {
      const acct = c.accountId ? accounts[c.accountId] : undefined;
      const acf = acct?.cf ?? {};
      const dataUlt = parseDateLoose(c.cf["DATA_DA_LTIMA_OPERAO"]);
      return {
        contactId: c.id,
        accountId: c.accountId,
        razaoSocial: acf["RAZAO_SOCIAL"] ?? acct?.name ?? "",
        clienteId: acf["ACCT_CLIENTE_ID"] ?? "",
        cnpj: acf["ACCT_CNPJ"] ?? "",
        ultimaOperacao: dataUlt ? dataUlt.toISOString() : null,
        email: c.email,
        phone: c.phone,
        valorAprovadoNaoOperado: parseMoneyLoose(acf["ACCT_VALOR_APROVADO_NO_OPERADO"]),
        limiteDisponivel: parseMoneyLoose(acf["ACCT_LIMITE_DISPONVEL"] ?? acf["ACCT_LIMITE_DISPONIVEL"]),
      };
    });

    if (data.tab === "sem_operar_15") {
      rows = rows.filter((r) => {
        if (!isApto(contacts.find((c) => c.id === r.contactId)?.cf["APTO"])) return false;
        if (!r.ultimaOperacao) return false;
        const d = new Date(r.ultimaOperacao);
        return d < cutoff15 && d >= cutoff30;
      });
      rows.sort((a, b) => (a.ultimaOperacao! < b.ultimaOperacao! ? -1 : 1));
    } else if (data.tab === "sem_operar_30") {
      rows = rows.filter((r) => {
        if (!isApto(contacts.find((c) => c.id === r.contactId)?.cf["APTO"])) return false;
        if (!r.ultimaOperacao) return false;
        return new Date(r.ultimaOperacao) < cutoff30;
      });
      rows.sort((a, b) => (a.ultimaOperacao! < b.ultimaOperacao! ? -1 : 1));
    } else if (data.tab === "valor_aprovado") {
      rows = rows.filter((r) => isApto(contacts.find((c) => c.id === r.contactId)?.cf["APTO"]) && r.valorAprovadoNaoOperado > 5000);
      rows.sort((a, b) => b.valorAprovadoNaoOperado - a.valorAprovadoNaoOperado);
    }

    const _debug = null;

    const pageSize = 20;
    const total = rows.length;
    const start = (data.page - 1) * pageSize;
    return {
      rows: rows.slice(start, start + pageSize),
      total,
      page: data.page,
      pageSize,
      _debug,
    } satisfies ListAlertasResult;
  });

// ─── Sub-tab 4: Alertas enviados ────────────────────────────────────────────

export type AlertaEnviadoRow = {
  id: string;
  cliente_id: string;
  cliente_nome: string | null;
  email_destino: string;
  data_envio: string;
  link_whatsapp_clicado: string | null;
  link_portal_clicado: string | null;
};

export const debugAlertasFields = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await getCreds(context.supabase, context.userId);

    // 1. Account custom fields (perstag + label)
    const metaJson = await acFetch(creds, "accountCustomFieldMeta", { limit: "100" });
    const acctFields = (metaJson.accountCustomFieldMeta ?? []).map((f: any) => ({
      id: String(f.id),
      perstag: f.perstag ?? null,
      fieldLabel: f.fieldLabel ?? null,
      fieldType: f.fieldType ?? null,
    }));

    // 2. First account + raw field values
    const acctJson = await acFetch(creds, "accounts", { limit: "1", include: "accountCustomFieldData" });
    const sampleAccount = (acctJson.accounts ?? [])[0] ?? null;
    const sampleFieldValues = (acctJson.accountCustomFieldData ?? [])
      .filter((fv: any) => sampleAccount && String(fv.accountId) === String(sampleAccount.id))
      .map((fv: any) => ({ customFieldId: String(fv.customFieldId), fieldValue: fv.fieldValue }));

    // 3. alertas_enviados count
    const db = context.supabase as any;
    const { count, data: recentRows, error } = await db
      .from("alertas_enviados")
      .select("id, cliente_nome, data_envio", { count: "exact" })
      .eq("user_id", context.userId)
      .order("data_envio", { ascending: false })
      .limit(3);

    return {
      acctFields,
      sampleAccount: sampleAccount ? { id: String(sampleAccount.id), name: sampleAccount.name } : null,
      sampleFieldValues,
      alertasEnviadosTotal: count ?? 0,
      alertasEnviadosRecentes: error ? [] : (recentRows ?? []),
    };
  });

export const listAlertasEnviados = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      page: z.number().int().min(1).default(1),
      cliente: z.string().max(100).regex(/^[\w\s@.\-À-ÿ]*$/).optional(),
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
    if (data.cliente) {
      const safe = data.cliente.replace(/[,()*]/g, "");
      q = q.or(`cliente_nome.ilike.%${safe}%,cliente_id.ilike.%${safe}%`);
    }
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
