import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Bem-vindo de volta");
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e.message ?? "Falha na autenticação");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email) { toast.error("Digite seu e-mail primeiro"); return; }
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      toast.success("E-mail de redefinição enviado — verifique sua caixa de entrada");
      setResetMode(false);
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível enviar o e-mail");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: "#193469" }}>
            <svg width="24" height="18" viewBox="0 0 36 28" fill="none">
              <path d="M2 22 C6 22 8 6 13 6 C18 6 20 22 25 22 C30 22 32 12 34 12" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 16 C6 16 8 4 12 4 C16 4 18 16 22 16 C26 16 28 8 30 8" stroke="#0660FE" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7"/>
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-[.06em] uppercase text-foreground">FLUXI</span>
            <span className="text-[9px] font-medium tracking-[0.18em] uppercase text-muted-foreground">by Adiante</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-7">
          {!resetMode ? (
            <>
              <h2 className="text-xl font-semibold">Acesso privado</h2>
              <p className="mt-1 text-sm text-muted-foreground">Entre com suas credenciais para acessar o painel.</p>
              <form onSubmit={submit} className="mt-5 space-y-4">
                <div>
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Senha</Label>
                    <button
                      type="button"
                      onClick={() => setResetMode(true)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Aguarde…" : "Entrar"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Redefinir senha</h2>
              <p className="mt-1 text-sm text-muted-foreground">Digite seu e-mail e enviaremos um link para criar uma nova senha.</p>
              <form onSubmit={sendReset} className="mt-5 space-y-4">
                <div>
                  <Label htmlFor="reset-email">E-mail</Label>
                  <Input id="reset-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" disabled={resetBusy} className="w-full">
                  {resetBusy ? "Enviando…" : "Enviar link de redefinição"}
                </Button>
                <button
                  type="button"
                  onClick={() => setResetMode(false)}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← voltar ao login
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">← voltar</Link>
        </p>
      </div>
    </div>
  );
}
