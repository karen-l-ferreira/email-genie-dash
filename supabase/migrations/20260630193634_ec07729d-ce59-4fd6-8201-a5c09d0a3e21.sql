DROP POLICY IF EXISTS "team alertas_contatos insert" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team alertas_contatos update" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team alertas_contatos delete" ON public.alertas_contatos;

CREATE POLICY "team alertas_contatos insert" ON public.alertas_contatos
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND contatado_por = auth.uid());

CREATE POLICY "team alertas_contatos update" ON public.alertas_contatos
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "team alertas_contatos delete" ON public.alertas_contatos
  FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);