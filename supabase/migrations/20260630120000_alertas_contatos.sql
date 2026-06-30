CREATE TABLE public.alertas_contatos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  contact_id TEXT NOT NULL,
  contatado BOOLEAN NOT NULL DEFAULT true,
  contatado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id)
);

CREATE INDEX alertas_contatos_user_contact_idx ON public.alertas_contatos (user_id, contact_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alertas_contatos TO authenticated;
GRANT ALL ON public.alertas_contatos TO service_role;

ALTER TABLE public.alertas_contatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own alertas_contatos select" ON public.alertas_contatos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own alertas_contatos insert" ON public.alertas_contatos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own alertas_contatos update" ON public.alertas_contatos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own alertas_contatos delete" ON public.alertas_contatos FOR DELETE USING (auth.uid() = user_id);
