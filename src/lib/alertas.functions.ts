import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Settings = { ac_api_key: string; ac_base_url: string };

const AC_HOST_RE = /^[a-z0-9-]+\.(api-[a-z0-9]+\.com|activehosted\.com)$/i;

// ─── AC field name constants ────────────────────────────────────────────────
// These are the exact personalization/perstag values from ActiveCampaign.
// Centralized here to avoid scattered magic strings.
const AC = {
  APTO:               "APTO",
  ULTIMA_OPERACAO:    "DATA_DA_LTIMA_OPERAO",
  RAZO_SOCIAL:        "RAZO_SOCIAL",
  ACCT_RAZO_SOCIAL:   "ACCT_RAZO_SOCIAL",
  ACCT_VALOR_APROVADO:"ACCT_VALOR_APROVADO_NO_OPERADO",
  ACCT_LIMITE:        "ACCT_LIMITE_DISPONVEL",
  ACCT_LIMITE_ALT:    "ACCT_LIMITE_DISPONIVEL",
  ACCT_CLIENTE_ID:    "ACCT_CLIENTE_ID",
  ACCT_CNPJ:          "ACCT_CNPJ",
} as const;

// ─── Server-side in-memory cache (5-min TTL) ───────────────────────────────
// Avoids re-fetching AC field maps and contact/account data on every request.
type CacheEntry<T> = { data: T; expiresAt: number };
const _cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 60 * 1000; // 1 min — garante dados frescos

function cacheGet<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() > e.expiresAt) { _cache.delete(key); return null; }
  return e.data as T;
}
function cacheSet<T>(key: string, data: T): T {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
  return data;
}

// ─── URL validation ─────────────────────────────────────────────────────────

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

// Legacy AC API — used for per-contact link click data (not in v3 REST)
async function acLegacyFetch(creds: Settings, params: Record<string, string>) {
  const baseParsed = assertAllowedAcUrl(creds.ac_base_url);
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

async function _loadContactFieldMap(creds: Settings): Promise<Record<string, string>> {
  const json = await acFetch(creds, "fields", { limit: "100" });
  const map: Record<string, string> = {};
  for (const f of (json.fields ?? []) as any[]) {
    if (f.perstag) map[String(f.perstag).toUpperCase()] = String(f.id);
  }
  return map;
}

async function loadContactFieldMap(creds: Settings): Promise<Record<string, string>> {
  const key = `cf:${creds.ac_api_key}`;
  return cacheGet<Record<string, string>>(key) ?? cacheSet(key, await _loadContactFieldMap(creds));
}

// ─── Account fields (personalization → fieldId) ────────────────────────────

async function _loadAccountFieldMap(creds: Settings): Promise<Record<string, string>> {
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

async function loadAccountFieldMap(creds: Settings): Promise<Record<string, string>> {
  const key = `acf:${creds.ac_api_key}`;
  return cacheGet<Record<string, string>>(key) ?? cacheSet(key, await _loadAccountFieldMap(creds));
}

// ─── Load all contacts with custom fields ──────────────────────────────────

type ContactData = {
  id: string;
  email: string;
  phone: string;
  accountId: string | null;
  cf: Record<string, string>;
};

async function _loadAllContacts(creds: Settings, fieldIdToPerstag: Record<string, string>): Promise<ContactData[]> {
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

async function loadAllContacts(creds: Settings, fieldIdToPerstag: Record<string, string>): Promise<ContactData[]> {
  const key = `contacts:${creds.ac_api_key}`;
  return cacheGet<ContactData[]>(key) ?? cacheSet(key, await _loadAllContacts(creds, fieldIdToPerstag));
}

// ─── Load all accounts with custom fields ──────────────────────────────────

type AccountData = {
  id: string;
  name: string;
  cf: Record<string, string>;
};

async function _loadAllAccounts(creds: Settings, acctFieldMap: Record<string, string>): Promise<Record<string, AccountData>> {
  const fieldIdToPersonalization: Record<string, string> = {};
  for (const [personalization, id] of Object.entries(acctFieldMap)) {
    fieldIdToPersonalization[id] = personalization;
  }

  const byId: Record<string, AccountData> = {};

  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await acFetch(creds, "accounts", {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      include: "accountCustomFieldData",
    });

    const cfByAcct: Record<string, Record<string, string>> = {};
    for (const fv of (json.customerAccountCustomFieldData ?? []) as any[]) {
      const aid = String(fv.customer_account_id ?? fv.customerAccount ?? "");
      const fid = String(fv.custom_field_id ?? fv.customerAccountCustomFieldMetum ?? "");
      if (!aid || !fid) continue;
      const personalization = fieldIdToPersonalization[fid];
      if (!personalization) continue;

      let val: string | null = null;
      if (fv.custom_field_currency_value != null && fv.custom_field_currency_value !== "") {
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

async function loadAllAccounts(creds: Settings, acctFieldMap: Record<string, string>): Promise<Record<string, AccountData>> {
  const key = `accounts:${creds.ac_api_key}`;
  return cacheGet<Record<string, AccountData>>(key) ?? cacheSet(key, await _loadAllAccounts(creds, acctFieldMap));
}

// ─── Shared helpers to extract contact fields ───────────────────────────────

function extractRazaoSocial(cf: Record<string, string>, acf: Record<string, string>, acctName: string): string {
  return cf[AC.RAZO_SOCIAL] ?? acf[AC.ACCT_RAZO_SOCIAL] ?? acctName ?? "";
}

function extractClienteId(cf: Record<string, string>, acf: Record<string, string>): string {
  return acf[AC.ACCT_CLIENTE_ID] ?? cf[AC.ACCT_CLIENTE_ID] ?? "";
}

function extractCnpj(cf: Record<string, string>, acf: Record<string, string>): string {
  return acf[AC.ACCT_CNPJ] ?? cf[AC.ACCT_CNPJ] ?? "";
}

function extractValorAprovado(cf: Record<string, string>, acf: Record<string, string>): number {
  return parseMoneyLoose(cf[AC.ACCT_VALOR_APROVADO] ?? acf[AC.ACCT_VALOR_APROVADO] ?? null);
}

function extractLimite(cf: Record<string, string>, acf: Record<string, string>): number {
  return parseMoneyLoose(
    cf[AC.ACCT_LIMITE] ?? acf[AC.ACCT_LIMITE] ??
    cf[AC.ACCT_LIMITE_ALT] ?? acf[AC.ACCT_LIMITE_ALT] ?? null,
  );
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
  followupEm: string | null;
  ultimoFollowupEm: string | null;
};

export type ListAlertasResult = {
  rows: AlertaClienteRow[];
  total: number;
  page: number;
  pageSize: number;
};

// ─── listAlertasClientes ───────────────────────────────────────────────────

const tabSchema = z.object({
  tab: z.enum(["sem_operar_15", "sem_operar_30", "valor_aprovado", "limite_disponivel"]),
  page: z.number().int().min(1).default(1),
  sort: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().default(""),
});

export const listAlertasClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => tabSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);

    const [contactFieldMap, acctFieldMap] = await Promise.all([
      loadContactFieldMap(creds),
      loadAccountFieldMap(creds),
    ]);

    const contactFieldIdToPerstag: Record<string, string> = {};
    for (const [perstag, id] of Object.entries(contactFieldMap)) {
      contactFieldIdToPerstag[id] = perstag;
    }

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
      const acf = acct?.cf ?? {};
      const dataUlt = parseDateLoose(c.cf[AC.ULTIMA_OPERACAO]);

      return {
        contactId: c.id,
        accountId: c.accountId,
        razaoSocial: extractRazaoSocial(c.cf, acf, acct?.name ?? ""),
        clienteId: extractClienteId(c.cf, acf),
        cnpj: extractCnpj(c.cf, acf),
        ultimaOperacao: dataUlt ? dataUlt.toISOString() : null,
        email: c.email,
        phone: c.phone,
        valorAprovadoNaoOperado: extractValorAprovado(c.cf, acf),
        limiteDisponivel: extractLimite(c.cf, acf),
        contatado: false,
        contatadoEm: null,
        followupEm: null,
        ultimoFollowupEm: null,
      };
    });

    const daysSortMult = data.sort === "desc" ? 1 : -1;

    if (data.tab === "sem_operar_15") {
      rows = rows.filter((r) => {
        const c = contactById.get(r.contactId);
        if (!isApto(c?.cf[AC.APTO])) return false;
        if (!r.ultimaOperacao) return false;
        const d = new Date(r.ultimaOperacao);
        return d < cutoff15 && d >= cutoff30;
      });
      rows.sort((a, b) => (a.ultimaOperacao! < b.ultimaOperacao! ? -daysSortMult : daysSortMult));
    } else if (data.tab === "sem_operar_30") {
      rows = rows.filter((r) => {
        const c = contactById.get(r.contactId);
        if (!isApto(c?.cf[AC.APTO])) return false;
        if (!r.ultimaOperacao) return false;
        return new Date(r.ultimaOperacao) < cutoff30;
      });
      rows.sort((a, b) => (a.ultimaOperacao! < b.ultimaOperacao! ? -daysSortMult : daysSortMult));
    } else if (data.tab === "valor_aprovado") {
      rows = rows.filter((r) => {
        const c = contactById.get(r.contactId);
        return isApto(c?.cf[AC.APTO]) && r.valorAprovadoNaoOperado > 5000;
      });
      rows.sort((a, b) => b.valorAprovadoNaoOperado - a.valorAprovadoNaoOperado);
    } else if (data.tab === "limite_disponivel") {
      rows = rows.filter((r) => {
        const c = contactById.get(r.contactId);
        return isApto(c?.cf[AC.APTO]) && r.limiteDisponivel > 5000 && r.valorAprovadoNaoOperado <= 0;
      });
      rows.sort((a, b) => b.limiteDisponivel - a.limiteDisponivel);
    }

    // Busca por nome, CNPJ ou ID
    if (data.search.trim()) {
      const q = data.search.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.razaoSocial.toLowerCase().includes(q) ||
        r.cnpj.toLowerCase().includes(q) ||
        r.clienteId.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q),
      );
    }

    // Busca contatados do Supabase para ordenar: não-ticados sempre primeiro
    const { data: contatadosDb } = await (context.supabase as any)
      .from("alertas_contatos")
      .select("contact_id, contatado, contatado_em, followup_em, ultimo_followup_em");
    type CtRow = { contatado: boolean; em: string | null; followupEm: string | null; ultimoFollowupEm: string | null };
    const contatadosMap = new Map<string, CtRow>();
    for (const row of contatadosDb ?? []) {
      contatadosMap.set(String(row.contact_id), {
        contatado: row.contatado,
        em: row.contatado_em,
        followupEm: row.followup_em ?? null,
        ultimoFollowupEm: row.ultimo_followup_em ?? null,
      });
    }

    // checkLevel: 0 = nenhum, 1 = contatado, 2 = followup, 3 = ultimo followup
    function checkLevel(ct: CtRow | undefined) {
      if (!ct?.contatado) return 0;
      if (!ct.followupEm) return 1;
      if (!ct.ultimoFollowupEm) return 2;
      return 3;
    }

    const withStatus = rows.map((r) => {
      const ct = contatadosMap.get(r.contactId);
      return {
        ...r,
        contatado: !!ct?.contatado,
        contatadoEm: ct?.em ?? null,
        followupEm: ct?.followupEm ?? null,
        ultimoFollowupEm: ct?.ultimoFollowupEm ?? null,
        _level: checkLevel(ct),
      };
    });

    // Ordena: 0 checks primeiro, 3 checks por último
    withStatus.sort((a, b) => a._level - b._level);
    const rowsOrdenados = withStatus.map(({ _level, ...r }) => r);

    const pageSize = 25;
    const total = rowsOrdenados.length;
    const start = (data.page - 1) * pageSize;
    return {
      rows: rowsOrdenados.slice(start, start + pageSize),
      total,
      page: data.page,
      pageSize,
    } satisfies ListAlertasResult;
  });

// ─── toggleAlertaContatado ─────────────────────────────────────────────────

export const toggleAlertaContatado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      contactId: z.string().min(1),
      // action: qual check está sendo acionado
      action: z.enum(["check1", "uncheck1", "check2", "uncheck2", "check3", "uncheck3"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const now = new Date().toISOString();

    if (data.action === "check1") {
      const { error } = await db.from("alertas_contatos").upsert(
        { contatado_por: context.userId, contact_id: data.contactId, contatado: true, contatado_em: now },
        { onConflict: "contact_id" },
      );
      if (error) throw new Error(error.message);
    } else if (data.action === "uncheck1") {
      // Desfaz tudo
      const { error } = await db.from("alertas_contatos").delete().eq("contact_id", data.contactId);
      if (error) throw new Error(error.message);
    } else if (data.action === "check2") {
      const { error } = await db.from("alertas_contatos")
        .update({ followup_em: now })
        .eq("contact_id", data.contactId);
      if (error) throw new Error(error.message);
    } else if (data.action === "uncheck2") {
      const { error } = await db.from("alertas_contatos")
        .update({ followup_em: null, ultimo_followup_em: null })
        .eq("contact_id", data.contactId);
      if (error) throw new Error(error.message);
    } else if (data.action === "check3") {
      const { error } = await db.from("alertas_contatos")
        .update({ ultimo_followup_em: now })
        .eq("contact_id", data.contactId);
      if (error) throw new Error(error.message);
    } else if (data.action === "uncheck3") {
      const { error } = await db.from("alertas_contatos")
        .update({ ultimo_followup_em: null })
        .eq("contact_id", data.contactId);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

// ─── listCliquesAlertas ────────────────────────────────────────────────────

const WHATSAPP_LINK_RE = /wa\.me|api\.whatsapp\.com/i;
const PORTAL_LINK_RE = /adiantesa\.com|adiante\.com\.br/i;

export type CliqueInfo = {
  contactId: string;
  email: string;
  phone: string;
  clicadoEm: string;
  razaoSocial: string;
  clienteId: string;
  cnpj: string;
};

export type CampanhaCliquesRow = {
  campanhaId: string;
  campanhaNome: string;
  sdate: string;
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

async function fetchContactEnrichment(
  creds: Settings,
  contactId: string,
  contactFieldIdToPerstag: Record<string, string>,
  acctFieldIdToPersonalization: Record<string, string>,
): Promise<{ razaoSocial: string; clienteId: string; cnpj: string; phone: string } | null> {
  const cacheKey = `enrich:${creds.ac_api_key}:${contactId}`;
  const cached = cacheGet<{ razaoSocial: string; clienteId: string; cnpj: string; phone: string }>(cacheKey);
  if (cached) return cached;

  try {
    const json = await acFetch(creds, `contacts/${contactId}`, { include: "fieldValues,accountContacts" });
    if (!json?.contact) return null;

    const cf: Record<string, string> = {};
    for (const fv of (json.fieldValues ?? []) as any[]) {
      if (!fv.field || fv.value == null || fv.value === "") continue;
      const perstag = contactFieldIdToPerstag[String(fv.field)];
      if (perstag) cf[perstag] = String(fv.value);
    }

    const accountId = (json.accountContacts ?? [])[0]?.account ? String(json.accountContacts[0].account) : null;
    let acf: Record<string, string> = {};
    let acctName = "";
    if (accountId) {
      const [acctJson, cfJson] = await Promise.all([
        acFetch(creds, `accounts/${accountId}`),
        acFetch(creds, `accounts/${accountId}/accountCustomFieldData`),
      ]);
      acctName = acctJson?.account?.name ?? "";
      for (const fv of (cfJson.customerAccountCustomFieldData ?? cfJson.accountCustomFieldData ?? []) as any[]) {
        const fid = String(fv.custom_field_id ?? fv.customerAccountCustomFieldMetum ?? "");
        const personalization = acctFieldIdToPersonalization[fid];
        if (!personalization) continue;
        let val: string | null = null;
        if (fv.custom_field_currency_value != null && fv.custom_field_currency_value !== "") {
          val = String(Number(fv.custom_field_currency_value) / 100);
        } else if (fv.custom_field_number_value != null && fv.custom_field_number_value !== "") {
          val = String(fv.custom_field_number_value);
        } else if (fv.custom_field_text_value != null && fv.custom_field_text_value !== "") {
          val = String(fv.custom_field_text_value);
        }
        if (val != null) acf[personalization] = val;
      }
    }

    const result = {
      razaoSocial: extractRazaoSocial(cf, acf, acctName),
      clienteId: extractClienteId(cf, acf),
      cnpj: extractCnpj(cf, acf),
      phone: json.contact?.phone ?? "",
    };
    return cacheSet(cacheKey, result);
  } catch {
    return null;
  }
}

export const listCliquesAlertas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ page: z.number().int().min(1).default(1) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const creds = await getCreds(context.supabase, context.userId);
    const cutoffStart = new Date(Date.now() - 60 * 86400000);

    const fieldMapsPromise = Promise.all([loadContactFieldMap(creds), loadAccountFieldMap(creds)]);

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
            phone: "",
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

    const [contactFieldMap, acctFieldMap] = await fieldMapsPromise;
    const contactFieldIdToPerstag: Record<string, string> = {};
    for (const [perstag, id] of Object.entries(contactFieldMap)) contactFieldIdToPerstag[id] = perstag;
    const acctFieldIdToPersonalization: Record<string, string> = {};
    for (const [personalization, id] of Object.entries(acctFieldMap)) acctFieldIdToPersonalization[id] = personalization;

    const distinctContactIds = new Set<string>();
    for (const camp of campanhasOut) {
      for (const entry of [...camp.whatsapp, ...camp.portal]) {
        if (entry.contactId) distinctContactIds.add(entry.contactId);
      }
    }

    const enrichMap = new Map<string, { razaoSocial: string; clienteId: string; cnpj: string; phone: string }>();
    await Promise.all(
      [...distinctContactIds].map(async (cid) => {
        const info = await fetchContactEnrichment(creds, cid, contactFieldIdToPerstag, acctFieldIdToPersonalization);
        if (info) enrichMap.set(cid, info);
      }),
    );

    for (const camp of campanhasOut) {
      for (const entry of [...camp.whatsapp, ...camp.portal]) {
        const info = enrichMap.get(entry.contactId);
        if (info) {
          entry.razaoSocial = info.razaoSocial;
          entry.clienteId = info.clienteId;
          entry.cnpj = info.cnpj;
          entry.phone = info.phone;
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
