DROP POLICY IF EXISTS "team alertas_contatos select" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team alertas_contatos update" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team alertas_contatos delete" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team alertas_contatos insert" ON public.alertas_contatos;

CREATE POLICY "Users select own alertas_contatos" ON public.alertas_contatos
  FOR SELECT TO authenticated
  USING (contatado_por = auth.uid());

CREATE POLICY "Users insert own alertas_contatos" ON public.alertas_contatos
  FOR INSERT TO authenticated
  WITH CHECK (contatado_por = auth.uid());

CREATE POLICY "Users update own alertas_contatos" ON public.alertas_contatos
  FOR UPDATE TO authenticated
  USING (contatado_por = auth.uid())
  WITH CHECK (contatado_por = auth.uid());

CREATE POLICY "Users delete own alertas_contatos" ON public.alertas_contatos
  FOR DELETE TO authenticated
  USING (contatado_por = auth.uid());