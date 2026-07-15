import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { analyzeEmailFree, type MessageAnalysis } from "@/lib/ai.functions";
import { Loader2, ScanText, ChevronDown, ChevronUp } from "lucide-react";

export const Route = createFileRoute("/analisar")({
  component: AnalisarPage,
});

const PRIORITY_COLOR: Record<string, string> = {
  P1: "bg-red-500/15 text-red-400 border-red-500/30",
  P2: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  P3: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <svg width="96" height="96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-2xl font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

function AnalisarPage() {
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MessageAnalysis | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function handleAnalyze() {
    if (!html.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await analyzeEmailFree({ data: { subject, html } });
      setAnalysis(res.analysis);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao analisar o e-mail.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pl-[220px]">
      <AppHeader />
      <main className="mx-auto max-w-[1100px] px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analisar E-mail</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cole o HTML do e-mail e receba uma análise completa.</p>
        </div>

        {/* Inputs */}
        <div className="space-y-3">
          <Input
            placeholder="Assunto do e-mail (opcional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="max-w-lg"
          />
          <Textarea
            placeholder="Cole o HTML do e-mail aqui..."
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            className="min-h-[220px] font-mono text-xs"
          />
          <Button onClick={handleAnalyze} disabled={loading || !html.trim()} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
            {loading ? "Analisando..." : "Analisar"}
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {/* Result */}
        {analysis && (
          <div className="space-y-6">
            {/* Score + resumo */}
            <div className="flex items-center gap-6 rounded-xl border border-border bg-surface p-6">
              <ScoreRing score={analysis.score} />
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">Score geral</div>
                <div className="text-3xl font-bold">{analysis.score}/100</div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Pontos fortes */}
              {analysis.strengths.length > 0 && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-5 space-y-2">
                  <div className="text-sm font-semibold text-green-400">Pontos fortes</div>
                  <ul className="space-y-1.5">
                    {analysis.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm text-foreground/80">
                        <span className="mt-0.5 text-green-400">✓</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pontos fracos */}
              {analysis.weaknesses.length > 0 && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 space-y-2">
                  <div className="text-sm font-semibold text-red-400">Pontos fracos</div>
                  <ul className="space-y-1.5">
                    {analysis.weaknesses.map((w, i) => (
                      <li key={i} className="flex gap-2 text-sm text-foreground/80">
                        <span className="mt-0.5 text-red-400">✗</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Sugestões */}
            {analysis.suggestions.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-muted-foreground">Sugestões</div>
                {analysis.suggestions.map((s: any, i: number) => (
                  <div key={i} className="rounded-lg border border-border bg-surface p-4 flex gap-3 items-start">
                    <Badge className={`shrink-0 text-xs border ${PRIORITY_COLOR[s.priority] ?? ""}`}>{s.priority}</Badge>
                    <div>
                      <div className="text-sm font-medium">{s.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{s.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            {html && (
              <div className="rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => setPreviewOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
                >
                  Prévia do e-mail
                  {previewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {previewOpen && (
                  <iframe
                    srcDoc={html}
                    className="w-full border-t border-border"
                    style={{ height: 600 }}
                    sandbox=""
                  />
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
