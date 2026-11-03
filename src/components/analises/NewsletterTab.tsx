import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Mail } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Campaign } from "@/lib/ac.functions";
import { Advice, EmptyState, Explainer, Notice, Panel, Stat, Tag, type Tone } from "@/components/app/ui-kit";
import { cn } from "@/lib/utils";
import { fmtDeltaPp, fmtPct, fmtRel, isNoise, parseSendDate, toSendMetrics, type SendMetrics } from "@/lib/analysis/series";
import { isRealSend, summarize } from "@/lib/analysis/overview";

const IS_NEWSLETTER = /^\s*\[newsletter\]/i;
const WINDOW = 5; // editions per comparison block

function agg(s: SendMetrics[]) {
  const sent = s.reduce((a, x) => a + x.sent, 0);
  const opens = s.reduce((a, x) => a + (x.open_rate / 100) * x.sent, 0);
  const clicks = s.reduce((a, x) => a + (x.ctr / 100) * x.sent, 0);
  const unsubs = s.reduce((a, x) => a + (x.unsub_rate / 100) * x.sent, 0);
  return {
    editions: s.length,
    sent,
    open: sent > 0 ? (opens / sent) * 100 : 0,
    ctr: sent > 0 ? (clicks / sent) * 100 : 0,
    ctor: opens > 0 ? (clicks / opens) * 100 : 0,
    unsubs: Math.round(unsubs),
    unsubRate: sent > 0 ? (unsubs / sent) * 100 : 0,
  };
}

type Verdict = { label: string; tone: Tone; headline: string; advice: string } | null;

// "Is it working?": the last 5 editions against the 5 before them, same volume-weighted rule everywhere.
function verdictFor(recent: SendMetrics[], before: SendMetrics[]): Verdict {
  if (before.length < 3) return null;
  const r = agg(recent);
  const b = agg(before);
  const openRel = b.open > 0 ? (r.open - b.open) / b.open : 0;
  const ctrRel = b.ctr > 0 ? (r.ctr - b.ctr) / b.ctr : 0;
  const headline =
    `Nas últimas ${recent.length} edições, ${fmtPct(r.open)} dos contatos abriram (nas ${before.length} anteriores: ${fmtPct(b.open)}) ` +
    `e ${fmtPct(r.ctr, 2)} clicaram (antes: ${fmtPct(b.ctr, 2)}).`;
  if (openRel >= 0.1 && ctrRel >= 0.1)
    return { label: "Melhorando", tone: "good", headline, advice: "Veja o que mudou nessas edições (assunto, tema, dia de envio) e repita nas próximas." };
  if (openRel <= -0.1 && ctrRel <= -0.1)
    return { label: "Piorando", tone: "bad", headline, advice: "Abriram menos e clicaram menos. Confira se o público ou a lista mudou e teste um assunto diferente antes de mexer no conteúdo." };
  if (openRel <= -0.1)
    return { label: "Piorando a abertura", tone: "warn", headline, advice: "Menos gente está abrindo. O problema está em chamar atenção: teste outro assunto, outro horário e confira se não cai no spam." };
  if (ctrRel <= -0.1)
    return { label: "Piorando os cliques", tone: "warn", headline, advice: "A abertura se mantém, mas menos gente clica. Revise os botões, os links e se o conteúdo chama para uma ação." };
  if (openRel >= 0.1 || ctrRel >= 0.1)
    return { label: "Melhorando um pouco", tone: "good", headline, advice: "Uma das medidas subiu e a outra está estável. Descubra o que mudou para repetir." };
  return { label: "Estável", tone: "neutral", headline, advice: "Sem mudança relevante. Para melhorar, teste um assunto ou um horário diferente em uma das próximas edições." };
}

export function NewsletterTab({ campaigns }: { campaigns: Campaign[] }) {
  const editions = useMemo(
    () =>
      campaigns
        .filter((c) => IS_NEWSLETTER.test(c.name))
        .map(toSendMetrics)
        .filter((s): s is SendMetrics => s !== null && !isNoise(s))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [campaigns],
  );
  const others = useMemo(() => summarize(campaigns.filter((c) => !IS_NEWSLETTER.test(c.name) && isRealSend(c))), [campaigns]);

  if (editions.length === 0) {
    return (
      <div>
        <Explainer title="O que é esta aba">Mostra se a newsletter está dando resultado: quantas pessoas abrem, quantas clicam e se isso está melhorando.</Explainer>
        <EmptyState
          icon={Mail}
          title="Não achei edições da newsletter"
          description='Procuro campanhas cujo nome começa com "[Newsletter]". Se as edições têm outro nome, me avise qual.'
        />
      </div>
    );
  }

  const total = agg(editions);
  const recent = editions.slice(0, WINDOW);
  const before = editions.slice(WINDOW, WINDOW * 2);
  const verdict = verdictFor(recent, before);
  const first = editions[editions.length - 1];
  const last = editions[0];

  const byOpen = [...editions].sort((a, b) => b.open_rate - a.open_rate);
  const byCtr = [...editions].sort((a, b) => b.ctr - a.ctr);
  const best = byCtr[0];
  const worst = byCtr[byCtr.length - 1];

  const chart = [...editions].reverse().map((s) => ({
    nome: format(parseSendDate(s.date), "dd/MM"),
    Abriram: Number(s.open_rate.toFixed(1)),
    Clicaram: Number(s.ctr.toFixed(2)),
  }));

  const vsOthersOpen = others.open_rate > 0 ? (total.open - others.open_rate) / others.open_rate : null;
  const vsOthersCtr = others.ctr > 0 ? (total.ctr - others.ctr) / others.ctr : null;

  return (
    <div className="space-y-6">
      <Explainer title="O que é esta aba">
        Mostra se a newsletter <strong>está dando resultado</strong>: quantas pessoas abrem, quantas clicam, se isso está melhorando ou piorando e qual edição foi melhor. Só entram campanhas
        cujo nome começa com <strong>[Newsletter]</strong>.
      </Explainer>

      <Panel>
        {verdict ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold tracking-tight">A newsletter está…</h2>
              <Tag tone={verdict.tone}>{verdict.label}</Tag>
            </div>
            <p className="mt-3 text-base leading-relaxed text-foreground">{verdict.headline}</p>
            <div className="mt-3">
              <Advice tone={verdict.tone}>{verdict.advice}</Advice>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Só {editions.length} edição(ões) até agora. Preciso de pelo menos {WINDOW + 3} para dizer se está melhorando ou piorando. Enquanto isso, veja os números abaixo.
          </p>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Mail}
          label="Edições enviadas"
          value={String(total.editions)}
          sub={`de ${format(parseSendDate(first.date), "d MMM yyyy", { locale: ptBR })} a ${format(parseSendDate(last.date), "d MMM yyyy", { locale: ptBR })}`}
        />
        <Stat
          label="Abriram o e-mail"
          value={fmtPct(total.open)}
          delta={vsOthersOpen != null ? `${fmtRel(vsOthersOpen)} vs outros disparos` : undefined}
          tone={vsOthersOpen == null ? "neutral" : vsOthersOpen >= 0 ? "good" : "bad"}
          sub={`média de todas as edições · outros disparos: ${fmtPct(others.open_rate)}`}
        />
        <Stat
          label="Clicaram"
          value={fmtPct(total.ctr, 2)}
          delta={vsOthersCtr != null ? `${fmtRel(vsOthersCtr)} vs outros disparos` : undefined}
          tone={vsOthersCtr == null ? "neutral" : vsOthersCtr >= 0 ? "good" : "bad"}
          sub={`${fmtPct(total.ctor)} dos que abriram · outros disparos: ${fmtPct(others.ctr, 2)}`}
        />
        <Stat label="Descadastros" value={total.unsubs.toLocaleString("pt-BR")} sub={`${fmtPct(total.unsubRate, 2)} dos envios`} />
      </div>
      <p className="text-xs text-muted-foreground">
        As médias consideram o tamanho de cada envio (uma edição enviada para mais gente pesa mais). "Outros disparos" são todas as campanhas que não são newsletter.
      </p>

      <Panel title="Como foi cada edição" description="Percentual de cada edição, da mais antiga à mais recente.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e7f1" vertical={false} />
              <XAxis dataKey="nome" tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5f6f8a" }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e1e7f1", fontSize: 12 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Abriram" stroke="#0660FE" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Clicaram" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {editions.length >= 3 && (
        <Panel title="Melhor e pior edição">
          <ul className="space-y-3 text-sm leading-relaxed">
            <li>
              <strong className="font-semibold text-success">Mais cliques:</strong> {best.name} ({format(parseSendDate(best.date), "dd/MM/yy")}), com {fmtPct(best.ctr, 2)} de cliques e{" "}
              {fmtPct(best.open_rate)} de abertura.
            </li>
            <li>
              <strong className="font-semibold text-destructive">Menos cliques:</strong> {worst.name} ({format(parseSendDate(worst.date), "dd/MM/yy")}), com {fmtPct(worst.ctr, 2)} de cliques e{" "}
              {fmtPct(worst.open_rate)} de abertura.
            </li>
            <li>
              <strong className="font-semibold">Mais aberturas:</strong> {byOpen[0].name} ({format(parseSendDate(byOpen[0].date), "dd/MM/yy")}), com {fmtPct(byOpen[0].open_rate)}.
            </li>
          </ul>
          <div className="mt-4">
            <Advice tone="good">compare o assunto e o tema da melhor com os da pior edição. A diferença costuma mostrar o que funciona com o seu público.</Advice>
          </div>
        </Panel>
      )}

      <Panel title="Todas as edições" description="O número pequeno embaixo compara com a edição anterior." flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Edição</th>
                <th className="px-3 py-3 text-left font-medium">Data</th>
                <th className="px-3 py-3 text-right font-medium">Enviados</th>
                <th className="px-3 py-3 text-right font-medium">Abriram</th>
                <th className="px-3 py-3 text-right font-medium">Clicaram</th>
                <th className="px-5 py-3 text-right font-medium">Descadastros</th>
              </tr>
            </thead>
            <tbody>
              {editions.map((s, i) => {
                const prev = editions[i + 1];
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="max-w-[300px] truncate px-5 py-3 text-[13px] font-medium">{s.name}</td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">{format(parseSendDate(s.date), "dd/MM/yy")}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.sent.toLocaleString("pt-BR")}</td>
                    <Cell cur={s.open_rate} prev={prev?.open_rate} up />
                    <Cell cur={s.ctr} prev={prev?.ctr} digits={2} up />
                    <Cell cur={s.unsub_rate} prev={prev?.unsub_rate} digits={2} last />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Notice tone="info">
        Isto mede o que acontece no e-mail (abrir e clicar). Para saber se quem abriu a newsletter depois fez uma operação, use a aba <strong>Influência</strong>.
      </Notice>
    </div>
  );
}

function Cell({ cur, prev, digits = 1, up, last }: { cur: number; prev?: number; digits?: number; up?: boolean; last?: boolean }) {
  const diff = prev === undefined ? null : cur - prev;
  const rel = diff !== null && prev ? Math.abs(diff / prev) : 0;
  const good = diff === null || rel < 0.05 ? null : up ? diff > 0 : diff < 0;
  return (
    <td className={cn("py-3 text-right tabular-nums", last ? "px-5" : "px-3")}>
      <div className="text-[13px] font-medium">{fmtPct(cur, digits)}</div>
      {diff !== null && (
        <div className={cn("text-[11px]", good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive")}>{fmtDeltaPp(diff, digits)}</div>
      )}
    </td>
  );
}
