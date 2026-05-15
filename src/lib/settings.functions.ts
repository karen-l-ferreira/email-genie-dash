import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_settings")
      .select("ac_api_key, ac_base_url, benchmark_open_rate, benchmark_ctr")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      hasApiKey: Boolean(data?.ac_api_key),
      ac_base_url: data?.ac_base_url ?? "https://gcbinvestimentos.api-us1.com/api/3/",
      benchmark_open_rate: Number(data?.benchmark_open_rate ?? 22),
      benchmark_ctr: Number(data?.benchmark_ctr ?? 2.9),
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        ac_api_key: z.string().min(10).max(500).optional(),
        ac_base_url: z
          .string()
          .url()
          .max(300)
          .refine((v) => {
            try {
              const u = new URL(v);
              return u.protocol === "https:" && /^[\w-]+\.api-[a-z0-9]+\.com$/i.test(u.hostname);
            } catch {
              return false;
            }
          }, "Must be an https ActiveCampaign URL (e.g. https://your-account.api-us1.com/api/3/)")
          .optional(),
        benchmark_open_rate: z.number().min(0).max(100).optional(),
        benchmark_ctr: z.number().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch = {
      user_id: userId,
      updated_at: new Date().toISOString(),
      ...(data.ac_api_key ? { ac_api_key: data.ac_api_key } : {}),
      ...(data.ac_base_url ? { ac_base_url: data.ac_base_url } : {}),
      ...(data.benchmark_open_rate !== undefined ? { benchmark_open_rate: data.benchmark_open_rate } : {}),
      ...(data.benchmark_ctr !== undefined ? { benchmark_ctr: data.benchmark_ctr } : {}),
    };
    const { error } = await supabase.from("user_settings").upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });