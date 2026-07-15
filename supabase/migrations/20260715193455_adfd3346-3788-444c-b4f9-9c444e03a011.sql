DROP POLICY IF EXISTS "allowed write" ON public.alertas_contatos;

CREATE POLICY "admin write" ON public.alertas_contatos
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.app_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );