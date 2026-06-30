-- Torna o status "contatado" compartilhado entre toda a equipe (não mais por usuário).
-- Mantém registro de quem marcou (contatado_por) para visibilidade/controle.

DROP POLICY IF EXISTS "own alertas_contatos select" ON public.alertas_contatos;
DROP POLICY IF EXISTS "own alertas_contatos insert" ON public.alertas_contatos;
DROP POLICY IF EXISTS "own alertas_contatos update" ON public.alertas_contatos;
DROP POLICY IF EXISTS "own alertas_contatos delete" ON public.alertas_contatos;

ALTER TABLE public.alertas_contatos DROP CONSTRAINT IF EXISTS alertas_contatos_user_id_contact_id_key;

ALTER TABLE public.alertas_contatos RENAME COLUMN user_id TO contatado_por;
ALTER TABLE public.alertas_contatos ALTER COLUMN contatado_por DROP NOT NULL;

ALTER TABLE public.alertas_contatos ADD CONSTRAINT alertas_contatos_contact_id_key UNIQUE (contact_id);

DROP INDEX IF EXISTS alertas_contatos_user_contact_idx;
CREATE INDEX IF NOT EXISTS alertas_contatos_contact_idx ON public.alertas_contatos (contact_id);

-- Qualquer usuário autenticado pode ver e alterar (ferramenta interna de equipe)
CREATE POLICY "team alertas_contatos select" ON public.alertas_contatos FOR SELECT TO authenticated USING (true);
CREATE POLICY "team alertas_contatos insert" ON public.alertas_contatos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "team alertas_contatos update" ON public.alertas_contatos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "team alertas_contatos delete" ON public.alertas_contatos FOR DELETE TO authenticated USING (true);
