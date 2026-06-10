import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MODEL = "gemini-2.5-flash";

async function callGemini(messages: Array<{ role: string; content: string }>) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_AI_API_KEY não configurada");

  // Convert OpenAI-style messages to Gemini format
  const systemMsg = messages.find((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role !== "system");

  const contents = userMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  };

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (res.status === 429) throw new Error("Limite de requisições de IA atingido. Tente novamente em instantes.");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`API do Google ${res.status}: ${t.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return parseJSON(content);
}

function parseJSON(content: string): any {
  try { return JSON.parse(content); } catch {}
  // Try to extract JSON block from response
  const match = content.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return { raw: content };
}

// Strip <style> and <script> tags from HTML to reduce token count.
// Returns the cleaned HTML and the extracted style blocks separately.
function stripStyles(html: string): { clean: string; styles: string } {
  const styleTags: string[] = [];
  const clean = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, (m) => { styleTags.push(m); return ""; })
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { clean, styles: styleTags.join("\n") };
}

// Re-inject extracted style blocks into a variation HTML before </head>.
function reinjectStyles(html: string, styles: string): string {
  if (!styles) return html;
  const idx = html.indexOf("</head>");
  if (idx !== -1) return html.slice(0, idx) + styles + html.slice(idx);
  return styles + html;
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
  refresh: z.boolean().optional(),
});

export const getRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CampaignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.refresh) {
      const { data: cached } = await supabase
        .from("campaign_ai_cache")
        .select("payload")
        .eq("user_id", userId)
        .eq("campaign_id", data.campaign_id)
        .eq("kind", "recommendations")
        .maybeSingle();
      if (cached?.payload) return cached.payload as { recommendations: Recommendation[] };
    }

    const sys = `Você é um analista de e-mail marketing especialista. Responda SEMPRE em português do Brasil (PT-BR). Dado o desempenho de uma campanha em relação aos benchmarks, gere de 3 a 5 recomendações priorizadas de melhoria no formato JSON estrito: {"recommendations":[{"priority":"P1"|"P2"|"P3","category":"CONTENT"|"SEGMENTATION"|"TIMING"|"CHANNEL","title":"título curto em PT-BR","description":"ação concreta em uma linha com dados numéricos reais, em PT-BR"}]}. Use os números reais nas descrições.`;

    const user = `Campanha: ${data.name}
Assunto: ${data.subject ?? "(desconhecido)"}
Envios: ${data.send_amt}
Aberturas únicas: ${data.uniqueopens} (Taxa de abertura ${data.open_rate.toFixed(1)}% vs benchmark ${data.benchmark_open_rate}%)
Cliques únicos: ${data.uniquelinkclicks} (CTR ${data.ctr.toFixed(2)}% vs benchmark ${data.benchmark_ctr}%)
Hard bounces: ${data.hardbounces}
Descadastros: ${data.unsubscribes}
Retorne apenas JSON.`;

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

    // Strip CSS to reduce input size; we'll re-inject after generation
    const { clean: htmlClean, styles } = stripStyles(data.html);
    const htmlClipped = htmlClean.slice(0, 40000);

    const sys = `Você é um copywriter especialista em e-mail marketing. Responda SEMPRE em português do Brasil (PT-BR). Dado um e-mail original e recomendações de melhoria, produza exatamente 3 variações melhoradas. Regras:
- Mantenha a mesma estrutura HTML (layout, links, imagens, rodapé)
- Reescreva apenas o copy: títulos, corpo do texto e CTAs
- Assunto, alterações e copy devem estar em PT-BR
- Retorne JSON estrito sem markdown: {"variations":[{"subject":"novo assunto","changes":["o que mudou e por quê"],"html":"<html completo da variação>"}]} com exatamente 3 entradas.`;

    const recsText = JSON.stringify(data.recommendations).slice(0, 2000);
    const user = `Assunto original: ${data.subject}
Recomendações a aplicar: ${recsText}

HTML original (estilos CSS removidos para economizar espaço — mantenha a estrutura):
${htmlClipped}

Retorne apenas JSON com exatamente 3 variações.`;

    const result = await callGemini([
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);

    let variations: Variation[] = Array.isArray(result.variations) ? result.variations.slice(0, 3) : [];

    // Re-inject original CSS into each generated variation
    if (styles) {
      variations = variations.map((v) => ({ ...v, html: reinjectStyles(v.html, styles) }));
    }

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
  refresh: z.boolean().optional(),
});

export const getAutomationRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AutomationInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const cacheId = `auto_${data.automation_id}`;
    if (!data.refresh) {
      const { data: cached } = await supabase
        .from("campaign_ai_cache")
        .select("payload")
        .eq("user_id", userId)
        .eq("campaign_id", cacheId)
        .eq("kind", "recommendations")
        .maybeSingle();
      if (cached?.payload) return cached.payload as { recommendations: AutomationRecommendation[] };
    }

    const sys = `Você é um especialista em automações de e-mail marketing. Responda SEMPRE em português do Brasil (PT-BR). Dado o desempenho de uma automação do ActiveCampaign, gere de 3 a 5 recomendações priorizadas no formato JSON estrito: {"recommendations":[{"priority":"P1"|"P2"|"P3","category":"FLOW"|"SEGMENTATION"|"TIMING"|"CONTENT","title":"título curto em PT-BR","description":"ação concreta com dados numéricos reais, em PT-BR"}]}. Foque em problemas de abandono, reengajamento e lógica de fluxo.`;

    const user = `Automação: ${data.name}
Status: ${data.status}
Total de contatos que entraram: ${data.entered}
Total de contatos que saíram: ${data.exited}
Contatos ativos no momento: ${data.active}
Taxa de conclusão: ${data.completion_rate.toFixed(1)}%
Retorne apenas JSON.`;

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
  refresh: z.boolean().optional(),
});

export const getMessageAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MessageInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const cacheId = `msg_${data.message_id}`;
    if (!data.refresh) {
      const { data: cached } = await supabase
        .from("campaign_ai_cache")
        .select("payload")
        .eq("user_id", userId)
        .eq("campaign_id", cacheId)
        .eq("kind", "message_analysis")
        .maybeSingle();
      if (cached?.payload) return cached.payload as { analysis: MessageAnalysis };
    }

    const sys = `Você é um especialista em copywriting de e-mail marketing. Responda SEMPRE em português do Brasil (PT-BR). Analise o e-mail fornecido e retorne JSON estrito: {"analysis":{"score":0-100,"strengths":["ponto forte em PT-BR"],"weaknesses":["ponto fraco em PT-BR"],"suggestions":[{"priority":"P1"|"P2"|"P3","category":"CONTENT"|"SEGMENTATION"|"TIMING"|"CHANNEL","title":"título em PT-BR","description":"sugestão concreta em PT-BR"}]}}. Avalie: qualidade do assunto, personalização, clareza do CTA, tamanho do copy, legibilidade e responsividade mobile. Dê 2 a 4 pontos fortes, 2 a 4 pontos fracos e 2 a 4 sugestões.`;

    const { clean: htmlClean } = stripStyles(data.html);
    const htmlClipped = htmlClean.slice(0, 40000);

    const user = `Assunto: ${data.subject}

HTML do e-mail:
${htmlClipped}

Retorne apenas JSON.`;

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
