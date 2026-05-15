import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MODEL = "google/gemini-2.5-flash";

async function callGemini(messages: Array<{ role: string; content: string }>) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (res.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI gateway ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

const CampaignInput = z.object({
  campaign_id: z.string().min(1).max(64),
  name: z.string().max(500),
  subject: z.string().max(500).optional(),
  open_rate: z.number(),
  ctr: z.number(),
  send_amt: z.number(),
  uniqueopens: z.number(),
  uniquelinkclicks: z.number(),
  hardbounces: z.number(),
  unsubscribes: z.number(),
  benchmark_open_rate: z.number(),
  benchmark_ctr: z.number(),
});

export const getRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CampaignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cached } = await supabase
      .from("campaign_ai_cache")
      .select("payload")
      .eq("user_id", userId)
      .eq("campaign_id", data.campaign_id)
      .eq("kind", "recommendations")
      .maybeSingle();
    if (cached?.payload) return cached.payload as { recommendations: any[] };

    const sys = `You are an email marketing analyst. Given a campaign's performance vs benchmarks, output 3-5 prioritized improvement recommendations as strict JSON: {"recommendations":[{"priority":"P1"|"P2"|"P3","category":"CONTENT"|"SEGMENTATION"|"TIMING"|"CHANNEL","title":"short title","description":"one-line action with a concrete data point"}]}. Use the actual numbers in descriptions.`;
    const user = `Campaign: ${data.name}
Subject: ${data.subject ?? "(unknown)"}
Sends: ${data.send_amt}
Unique opens: ${data.uniqueopens} (Open rate ${data.open_rate.toFixed(1)}% vs benchmark ${data.benchmark_open_rate}%)
Unique link clicks: ${data.uniquelinkclicks} (CTR ${data.ctr.toFixed(2)}% vs benchmark ${data.benchmark_ctr}%)
Hard bounces: ${data.hardbounces}
Unsubscribes: ${data.unsubscribes}
Return JSON only.`;
    const result = await callGemini([
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
    const payload = { recommendations };
    await supabase.from("campaign_ai_cache").upsert(
      { user_id: userId, campaign_id: data.campaign_id, kind: "recommendations", payload },
      { onConflict: "user_id,campaign_id,kind" },
    );
    return payload;
  });

const VariationsInput = z.object({
  campaign_id: z.string().min(1).max(64),
  subject: z.string().max(500),
  html: z.string().max(200000),
  recommendations: z.array(z.any()).max(20),
  refresh: z.boolean().optional(),
});

export const getVariations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => VariationsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.refresh) {
      const { data: cached } = await supabase
        .from("campaign_ai_cache")
        .select("payload")
        .eq("user_id", userId)
        .eq("campaign_id", data.campaign_id)
        .eq("kind", "variations")
        .maybeSingle();
      if (cached?.payload) return cached.payload as { variations: any[] };
    }

    const sys = `You are an email copywriter. Given an original email and improvement recommendations, produce 3 distinct improved variations. Each variation MUST keep the original HTML structure intact (same layout, images, links, footer) but rewrite the copy. Return strict JSON: {"variations":[{"subject":"new subject","changes":["bullet of what changed and why"],"html":"<full email html>"}]} - exactly 3 entries. Do not add markdown fences.`;
    const recsText = JSON.stringify(data.recommendations).slice(0, 4000);
    const htmlClipped = data.html.slice(0, 60000);
    const user = `Original subject: ${data.subject}
Recommendations to apply: ${recsText}

Original HTML:
${htmlClipped}

Return JSON only with exactly 3 variations.`;
    const result = await callGemini([
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    const variations = Array.isArray(result.variations) ? result.variations.slice(0, 3) : [];
    const payload = { variations };
    await supabase.from("campaign_ai_cache").upsert(
      { user_id: userId, campaign_id: data.campaign_id, kind: "variations", payload },
      { onConflict: "user_id,campaign_id,kind" },
    );
    return payload;
  });