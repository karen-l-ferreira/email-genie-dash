import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart3, Bell, GitBranch, Mail, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/")({ ssr: false, component: LandingPage });

function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border bg-surface/60 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: "#193469" }}>
              <svg width="22" height="17" viewBox="0 0 36 28" fill="none">
                <path d="M2 22 C6 22 8 6 13 6 C18 6 20 22 25 22 C30 22 32 12 34 12" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 16 C6 16 8 4 12 4 C16 4 18 16 22 16 C26 16 28 8 30 8" stroke="#0660FE" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7"/>
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[15px] font-bold tracking-[.06em] uppercase text-foreground">FLUXI</span>
              <span className="text-[9px] font-medium tracking-[0.18em] uppercase text-muted-foreground">by Adiante</span>
            </div>
          </div>
          <Button asChild size="sm">
            <Link to="/login">Entrar</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h1 className="mt-4 text-5xl font-bold tracking-tight">
          Inteligência de campanhas<br />
          <span className="text-primary">para a Adiante</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Acompanhe fluxos, alertas de clientes e influência de e-mail em tempo real — tudo integrado ao ActiveCampaign.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button asChild size="lg" className="px-8">
            <Link to="/login">Acessar painel</Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-5 md:grid-cols-3">
          <FeatureCard
            icon={<Mail className="h-5 w-5 text-primary" />}
            title="Campanhas"
            description="Visualize taxas de abertura, CTR, bounces e descadastros. Compare com benchmarks e identifique oportunidades."
          />
          <FeatureCard
            icon={<GitBranch className="h-5 w-5 text-primary" />}
            title="Fluxos"
            description="Monitore funis de automação: entradas, ativas, saídas e taxa de conclusão."
          />
          <FeatureCard
            icon={<Bell className="h-5 w-5 text-primary" />}
            title="Alertas"
            description="Clientes inativos, valor aprovado não operado e limite disponível — tudo monitorado automaticamente."
          />
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <FeatureCard
            icon={<BarChart3 className="h-5 w-5 text-primary" />}
            title="Dashboard analítico"
            description="Visão consolidada de todas as suas métricas: médias de abertura, CTR, score geral e tendências recentes."
          />
          <FeatureCard
            icon={<TrendingUp className="h-5 w-5 text-primary" />}
            title="Influência"
            description="Veja quem abriu o e-mail e operou em seguida — meça o impacto real de cada campanha."
          />
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        Fluxi by Adiante — acesso privado
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
