import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Activity, BarChart3, GitBranch, Mail, Sparkles, TrendingUp } from "lucide-react";

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
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <Activity className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">CRM Analytica</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">ActiveCampaign Intelligence</div>
            </div>
          </div>
          <Button asChild size="sm">
            <Link to="/login">Entrar</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Análise inteligente com IA
        </div>
        <h1 className="mt-4 text-5xl font-bold tracking-tight">
          Seu painel de inteligência<br />
          <span className="text-primary">ActiveCampaign</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Acompanhe campanhas, automações e métricas em tempo real. Obtenha recomendações de melhoria geradas por IA e tome decisões baseadas em dados.
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
            title="Automações"
            description="Monitore funis de automação: entradas, ativas, saídas e taxa de conclusão. Detecte gargalos com IA."
          />
          <FeatureCard
            icon={<Sparkles className="h-5 w-5 text-primary" />}
            title="Análise por IA"
            description="Recomendações priorizadas, variações de e-mail geradas por IA e análise de copy com pontuação 0–100."
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
            title="Benchmarks personalizados"
            description="Defina seus próprios benchmarks de abertura e CTR para comparar o desempenho real das campanhas."
          />
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        CRM Analytica — acesso privado
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
