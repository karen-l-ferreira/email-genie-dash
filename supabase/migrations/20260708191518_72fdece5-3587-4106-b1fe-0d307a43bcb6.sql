
-- alertas_contatos: replace permissive write policies with owner-scoped ones; keep team-wide read
DROP POLICY IF EXISTS "team insert" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team update" ON public.alertas_contatos;
DROP POLICY IF EXISTS "team delete" ON public.alertas_contatos;

CREATE POLICY "own contatos insert"
  ON public.alertas_contatos
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = contatado_por);

CREATE POLICY "own contatos update"
  ON public.alertas_contatos
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = contatado_por)
  WITH CHECK (auth.uid() = contatado_por);

CREATE POLICY "own contatos delete"
  ON public.alertas_contatos
  FOR DELETE
  TO authenticated
  USING (auth.uid() = contatado_por);

-- campaign_daily_stats: add owner column and lock policies to owner
ALTER TABLE public.campaign_daily_stats
  ADD COLUMN IF NOT EXISTS user_id uuid;

DROP POLICY IF EXISTS "all_auth" ON public.campaign_daily_stats;

CREATE POLICY "own stats select"
  ON public.campaign_daily_stats
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "own stats insert"
  ON public.campaign_daily_stats
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own stats update"
  ON public.campaign_daily_stats
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own stats delete"
  ON public.campaign_daily_stats
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
