import type { EmailFeatures } from "@/lib/ac.functions";
import type { SendMetrics } from "@/lib/analysis/series";

// "O que explica o resultado": split sends by a structural trait of the e-mail
// (subject length, number of links, CTA position...) and compare volume-weighted results.

export type Joined = { send: SendMetrics; f: EmailFeatures };

export function joinFeatures(sends: SendMetrics[], features: EmailFeatures[]): Joined[] {
  const byId = new Map(features.map((f) => [f.campaignId, f]));
  return sends.flatMap((s) => {
    const f = byId.get(s.id);
    return f ? [{ send: s, f }] : [];
  });
}

type Dimension = {
  key: string;
  label: string;
  buckets: string[]; // display order
  bucket: (f: EmailFeatures) => string;
};

const yn = (yes: string, no: string) => (b: boolean) => (b ? yes : no);

export const DIMENSIONS: Dimension[] = [
  {
    key: "subjectLen",
    label: "Tamanho do assunto",
    buckets: ["Curto (até 35)", "Médio (36 a 60)", "Longo (60+)"],
    bucket: (f) => (f.subjectLen <= 35 ? "Curto (até 35)" : f.subjectLen <= 60 ? "Médio (36 a 60)" : "Longo (60+)"),
  },
  {
    key: "emoji",
    label: "Emoji no assunto",
    buckets: ["Com emoji", "Sem emoji"],
    bucket: (f) => yn("Com emoji", "Sem emoji")(f.subjectHasEmoji),
  },
  {
    key: "number",
    label: "Número no assunto",
    buckets: ["Com número", "Sem número"],
    bucket: (f) => yn("Com número", "Sem número")(f.subjectHasNumber),
  },
  {
    key: "question",
    label: "Pergunta no assunto",
    buckets: ["Com pergunta", "Sem pergunta"],
    bucket: (f) => yn("Com pergunta", "Sem pergunta")(f.subjectHasQuestion),
  },
  {
    key: "personalized",
    label: "Personalização no assunto",
    buckets: ["Personalizado", "Genérico"],
    bucket: (f) => yn("Personalizado", "Genérico")(f.subjectPersonalized),
  },
  {
    key: "words",
    label: "Tamanho do texto",
    buckets: ["Enxuto (até 150 palavras)", "Médio (150 a 350)", "Longo (350+)"],
    bucket: (f) => (f.words <= 150 ? "Enxuto (até 150 palavras)" : f.words <= 350 ? "Médio (150 a 350)" : "Longo (350+)"),
  },
  {
    key: "links",
    label: "Quantidade de links",
    buckets: ["Até 2 links", "3 a 5 links", "6+ links"],
    bucket: (f) => (f.links <= 2 ? "Até 2 links" : f.links <= 5 ? "3 a 5 links" : "6+ links"),
  },
  {
    key: "images",
    label: "Imagens",
    buckets: ["Sem imagem", "1 a 2 imagens", "3+ imagens"],
    bucket: (f) => (f.images === 0 ? "Sem imagem" : f.images <= 2 ? "1 a 2 imagens" : "3+ imagens"),
  },
  {
    key: "firstLink",
    label: "Posição do primeiro link",
    buckets: ["No topo", "No meio", "No fim"],
    bucket: (f) => (f.firstLinkPos < 0.25 ? "No topo" : f.firstLinkPos < 0.6 ? "No meio" : "No fim"),
  },
];

export type BucketResult = {
  bucket: string;
  n: number;
  sent: number;
  open_rate: number;
  ctr: number;
  ctor: number;
};

export type DimensionResult = {
  key: string;
  label: string;
  buckets: BucketResult[];
  best: BucketResult | null;
  worst: BucketResult | null;
  gapRel: number; // relative CTR gap between best and worst bucket
  confidence: "boa" | "moderada" | "baixa";
};

export const MIN_PER_BUCKET = 3;

export function analyzeDimensions(rows: Joined[]): DimensionResult[] {
  return DIMENSIONS.map((dim) => {
    const groups = new Map<string, Joined[]>();
    for (const r of rows) {
      const b = dim.bucket(r.f);
      groups.set(b, [...(groups.get(b) ?? []), r]);
    }
    const buckets: BucketResult[] = dim.buckets.flatMap((b) => {
      const g = groups.get(b) ?? [];
      if (g.length === 0) return [];
      const sent = g.reduce((s, r) => s + r.send.sent, 0);
      const w = (m: "open_rate" | "ctr" | "ctor") => g.reduce((s, r) => s + r.send[m] * r.send.sent, 0) / sent;
      return [{ bucket: b, n: g.length, sent, open_rate: w("open_rate"), ctr: w("ctr"), ctor: w("ctor") }];
    });

    const usable = buckets.filter((b) => b.n >= MIN_PER_BUCKET);
    const sorted = [...usable].sort((a, b) => b.ctr - a.ctr);
    const best = sorted[0] ?? null;
    const worst = sorted.length >= 2 ? sorted[sorted.length - 1] : null;
    const gapRel = best && worst && worst.ctr > 0 ? (best.ctr - worst.ctr) / worst.ctr : 0;
    const minN = usable.length >= 2 ? Math.min(...usable.map((b) => b.n)) : 0;
    const confidence = minN >= 8 ? "boa" : minN >= 5 ? "moderada" : "baixa";

    return { key: dim.key, label: dim.label, buckets, best, worst: worst && best ? worst : null, gapRel, confidence };
  });
}

export function rankDimensions(results: DimensionResult[]): DimensionResult[] {
  return results.filter((r) => r.best && r.worst).sort((a, b) => b.gapRel - a.gapRel);
}
