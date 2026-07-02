
DROP POLICY IF EXISTS "team delete" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team insert" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team select" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team update" ON public.alertas_contatos;

ALTER TABLE public.alertas_contatos ALTER COLUMN contatado_por SET NOT NULL;

CREATE POLICY "own select" ON public.alertas_contatos
  FOR SELECT TO authenticated
  USING (contatado_por = auth.uid());

CREATE POLICY "own insert" ON public.alertas_contatos
  FOR INSERT TO authenticated
  WITH CHECK (contatado_por = auth.uid());

CREATE POLICY "own update" ON public.alertas_contatos
  FOR UPDATE TO authenticated
  USING (contatado_por = auth.uid())
  WITH CHECK (contatado_por = auth.uid());

CREATE POLICY "own delete" ON public.alertas_contatos
  FOR DELETE TO authenticated
  USING (contatado_por = auth.uid());
