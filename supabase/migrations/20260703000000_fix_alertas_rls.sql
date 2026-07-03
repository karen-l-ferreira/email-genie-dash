-- Fix alertas_contatos RLS: garante policies de equipe, não por usuário.
-- Idempotente — pode rodar mesmo se o migration anterior já foi aplicado.

-- 1. Remove TODAS as policies existentes na tabela
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE tablename = 'alertas_contatos' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.alertas_contatos', pol.policyname);
  END LOOP;
END $$;

-- 2. Garante que a coluna se chama contatado_por (rename seguro)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alertas_contatos' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.alertas_contatos RENAME COLUMN user_id TO contatado_por;
  END IF;
END $$;

ALTER TABLE public.alertas_contatos ALTER COLUMN contatado_por DROP NOT NULL;

-- 3. Garante constraint única por contact_id (compartilhado entre equipe)
ALTER TABLE public.alertas_contatos DROP CONSTRAINT IF EXISTS alertas_contatos_user_id_contact_id_key;
ALTER TABLE public.alertas_contatos DROP CONSTRAINT IF EXISTS alertas_contatos_contact_id_key;
ALTER TABLE public.alertas_contatos ADD CONSTRAINT alertas_contatos_contact_id_key UNIQUE (contact_id);

-- 4. Recria policies de equipe (qualquer usuário autenticado)
CREATE POLICY "team alertas_contatos select" ON public.alertas_contatos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "team alertas_contatos insert" ON public.alertas_contatos
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "team alertas_contatos update" ON public.alertas_contatos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "team alertas_contatos delete" ON public.alertas_contatos
  FOR DELETE TO authenticated USING (true);
