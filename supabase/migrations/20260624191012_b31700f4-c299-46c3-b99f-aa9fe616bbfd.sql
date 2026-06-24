CREATE TABLE public.alertas_enviados (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  cliente_id TEXT NOT NULL,
  cliente_nome TEXT,
  email_destino TEXT NOT NULL,
  data_envio TIMESTAMPTZ NOT NULL DEFAULT now(),
  link_whatsapp_clicado TIMESTAMPTZ,
  link_portal_clicado TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alertas_enviados_user_data_idx ON public.alertas_enviados (user_id, data_envio DESC);
CREATE INDEX alertas_enviados_cliente_idx ON public.alertas_enviados (user_id, cliente_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alertas_enviados TO authenticated;
GRANT ALL ON public.alertas_enviados TO service_role;

ALTER TABLE public.alertas_enviados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own alertas select" ON public.alertas_enviados FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own alertas insert" ON public.alertas_enviados FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own alertas update" ON public.alertas_enviados FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own alertas delete" ON public.alertas_enviados FOR DELETE USING (auth.uid() = user_id);