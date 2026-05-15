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

// ─── Types ────────────────────────────────────────────────────────────────────

export type Recommendation = {
  priority: "P1" | "P2" | "P3";
  category: "CONTENT" | "SEGMENTATION" | "TIMING" | "CHANNEL";
  title: string;
  description: string;
};

export type Variation = {
  subject: string;
  changes: string[];
  html: string;
};

export type AutomationRecommendation = {
  priority: "P1" | "P2" | "P3";
  category: "FLOW" | "SEGMENTATION" | "TIMING" | "CONTENT";
  title: string;
  description: string;
};

export type MessageAnalysis = {
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: Recommendation[];
};

// ─── Campaign recommendations ─────────────────────────────────────────────────

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
    if (cached?.payload) return cached.payload as { recommendations: Recommendation[] };

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
    const recommendations: Recommendation[] = Array.isArray(result.recommendations) ? result.recommendations : [];
    const payload = { recommendations };
    await supabase.from("campaign_ai_cache").upsert(
      { user_id: userId, campaign_id: data.campaign_id, kind: "recommendations", payload },
      { onConflict: "user_id,campaign_id,kind" },
    );
    return payload;
  });

// ─── Email variations ─────────────────────────────────────────────────────────

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
      if (cached?.payload) return cached.payload as { variations: Variation[] };
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
    const variations: Variation[] = Array.isArray(result.variations) ? result.variations.slice(0, 3) : [];
    const payload = { variations };
    await supabase.from("campaign_ai_cache").upsert(
      { user_id: userId, campaign_id: data.campaign_id, kind: "variations", payload },
      { onConflict: "user_id,campaign_id,kind" },
    );
    return payload;
  });

// ─── Automation recommendations ───────────────────────────────────────────────

const AutomationInput = z.object({
  automation_id: z.string().min(1).max(64),
  name: z.string().max(500),
  status: z.string(),
  entered: z.number(),
  exited: z.number(),
  active: z.number(),
  completion_rate: z.number(),
});

export const getAutomationRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AutomationInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const cacheId = `auto_${data.automation_id}`;
    const { data: cached } = await supabase
      .from("campaign_ai_cache")
      .select("payload")
      .eq("user_id", userId)
      .eq("campaign_id", cacheId)
      .eq("kind", "recommendations")
      .maybeSingle();
    if (cached?.payload) return cached.payload as { recommendations: AutomationRecommendation[] };

    const sys = `You are an email marketing automation analyst. Given an ActiveCampaign automation's performance, output 3-5 prioritized improvement recommendations as strict JSON: {"recommendations":[{"priority":"P1"|"P2"|"P3","category":"FLOW"|"SEGMENTATION"|"TIMING"|"CONTENT","title":"short title","description":"one-line action with concrete data points"}]}. Focus on automation-specific issues like drop-off, re-engagement, and flow logic.`;
    const user = `Automation: ${data.name}
Status: ${data.status}
Total contacts entered: ${data.entered}
Total contacts exited: ${data.exited}
Currently active contacts: ${data.active}
Completion rate: ${data.completion_rate.toFixed(1)}%
Return JSON only.`;
    const result = await callGemini([
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    const recommendations: AutomationRecommendation[] = Array.isArray(result.recommendations)
      ? result.recommendations
      : [];
    const payload = { recommendations };
    await supabase.from("campaign_ai_cache").upsert(
      { user_id: userId, campaign_id: cacheId, kind: "recommendations", payload },
      { onConflict: "user_id,campaign_id,kind" },
    );
    return payload;
  });

// ─── Per-message analysis ─────────────────────────────────────────────────────

const MessageInput = z.object({
  campaign_id: z.string().min(1).max(64),
  message_id: z.string().min(1).max(64),
  subject: z.string().max(500),
  html: z.string().max(200000),
});

export const getMessageAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MessageInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const cacheId = `msg_${data.message_id}`;
    const { data: cached } = await supabase
      .from("campaign_ai_cache")
      .select("payload")
      .eq("user_id", userId)
      .eq("campaign_id", cacheId)
      .eq("kind", "message_analysis")
      .maybeSingle();
    if (cached?.payload) return cached.payload as { analysis: MessageAnalysis };

    const sys = `You are an email copywriting expert. Analyze this email and return strict JSON: {"analysis":{"score":0-100,"strengths":["..."],"weaknesses":["..."],"suggestions":[{"priority":"P1"|"P2"|"P3","category":"CONTENT"|"SEGMENTATION"|"TIMING"|"CHANNEL","title":"...","description":"..."}]}}. Score based on: subject line quality, personalization, CTA clarity, copy length, readability, mobile-friendliness. Give 2-4 strengths, 2-4 weaknesses, and 2-4 suggestions.`;
    const htmlClipped = data.html.slice(0, 60000);
    const user = `Subject: ${data.subject}

HTML:
${htmlClipped}

Return JSON only.`;
    const result = await callGemini([
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    const analysis: MessageAnalysis = result.analysis ?? {
      score: 0,
      strengths: [],
      weaknesses: [],
      suggestions: [],
    };
    const payload = { analysis };
    await supabase.from("campaign_ai_cache").upsert(
      { user_id: userId, campaign_id: cacheId, kind: "message_analysis", payload },
      { onConflict: "user_id,campaign_id,kind" },
    );
    return payload;
  });
