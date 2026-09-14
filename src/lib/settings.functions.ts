import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ActiveCampaign credentials are a single shared server secret (AC_API_KEY /
// AC_BASE_URL), not per-user data — see src/lib/ac.functions.ts. Only
// per-user benchmark preferences live in the database.

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_settings")
      .select("benchmark_open_rate, benchmark_ctr")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      hasApiKey: Boolean(process.env.AC_API_KEY),
      benchmark_open_rate: Number(data?.benchmark_open_rate ?? 22),
      benchmark_ctr: Number(data?.benchmark_ctr ?? 2.9),
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
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
      ...(data.benchmark_open_rate !== undefined ? { benchmark_open_rate: data.benchmark_open_rate } : {}),
      ...(data.benchmark_ctr !== undefined ? { benchmark_ctr: data.benchmark_ctr } : {}),
    };
    const { error } = await supabase.from("user_settings").upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });