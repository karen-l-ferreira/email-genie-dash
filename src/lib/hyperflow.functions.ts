import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Hyperflow Desk API. The key lives only as a server secret (HYPERFLOW_API_KEY), like
// AC_API_KEY: it is never sent to the browser or stored in the database, and the request
// host is fixed so it cannot be redirected elsewhere.
const BASE_URL = "https://desk-ext.hyperflowapis.global";

const REQUESTED_FIELDS = [
  "_id", "protocol", "status", "createdAt", "finishedAt",
  "agent.name", "department.name", "departments.name",
  "interactions.agent.name", "interactions.department.name", "interactions.transferAt",
  "classifications.name", "labels.name",
  "queuedTime", "firstInteractionAt", "messagesCount", "userInteractionTime", "systemInteractionTime",
  "isBroadcast", "channel", "channelAlias",
];

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

export const getHyperflowStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ configured: Boolean(process.env.HYPERFLOW_API_KEY) }));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// One page per call: the browser drives the pagination, so a long extraction never hits a
// server time limit and any page that fails can be reported as "not loaded".
export const fetchHyperflowPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        startDate: date,
        endDate: date,
        page: z.number().int().min(1).max(10000),
        limit: z.number().int().min(1).max(200).default(100),
        useFields: z.boolean().default(true),
        // Not documented which date shape the API wants: the client tries "ymd" first, then "iso".
        dateFormat: z.enum(["ymd", "iso"]).default("ymd"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const key = process.env.HYPERFLOW_API_KEY;
    if (!key) throw new Error("HYPERFLOW_NOT_CONFIGURED");

    const url = new URL("/chat/list-all", BASE_URL);
    const asParam = (d: string) => (data.dateFormat === "iso" ? `${d}T00:00:00.000Z` : d);
    url.searchParams.set("startDate", asParam(data.startDate));
    url.searchParams.set("endDate", asParam(data.endDate));
    url.searchParams.set("page", String(data.page));
    url.searchParams.set("limit", String(data.limit));
    if (data.useFields) url.searchParams.set("fields", REQUESTED_FIELDS.join(","));

    let lastStatus = 0;
    let lastBody = "";
    // What the API said about the failure (never the key): lets the screen show the real cause.
    const snippet = async (res: Response) => {
      const t = await res.text().catch(() => "");
      return t.replace(/\s+/g, " ").slice(0, 200);
    };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetch(url.toString(), { headers: { "api-key": key, Accept: "application/json" }, redirect: "manual" });
      } catch {
        lastStatus = 0;
        if (attempt === MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        continue;
      }
      lastStatus = res.status;
      if (res.ok) {
        const json: any = await res.json();
        return {
          docs: (Array.isArray(json?.docs) ? json.docs : []) as Record<string, unknown>[],
          hasNextPage: Boolean(json?.hasNextPage),
          nextPage: typeof json?.nextPage === "number" ? (json.nextPage as number) : null,
          page: data.page,
          attempts: attempt,
        };
      }
      if (res.status === 401 || res.status === 403) throw new Error("HYPERFLOW_AUTH");
      lastBody = await snippet(res);
      if (res.status === 400 || res.status === 422) throw new Error(`HYPERFLOW_BAD_REQUEST|${lastBody}`);
      if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
    throw new Error(`HYPERFLOW_FAILED_${lastStatus}|${lastBody}|${RETRYABLE.has(lastStatus) ? "retried" : "once"}`);
  });
