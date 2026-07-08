DROP POLICY IF EXISTS "team select" ON public.alertas_contatos;

CREATE POLICY "own contatos select"
  ON public.alertas_contatos
  FOR SELECT
  TO authenticated
  USING (auth.uid() = contatado_por);