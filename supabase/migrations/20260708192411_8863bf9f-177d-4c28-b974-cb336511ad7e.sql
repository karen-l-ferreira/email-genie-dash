CREATE TABLE IF NOT EXISTS public.app_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user'))
);

GRANT SELECT ON public.app_roles TO authenticated;
GRANT ALL ON public.app_roles TO service_role;

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own role" ON public.app_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

INSERT INTO public.app_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'karen.barros@gcbinvestimentos.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.app_roles (user_id, role)
SELECT id, 'user' FROM auth.users WHERE email = 'bruno.rodrigues@gcbinvestimentos.com'
ON CONFLICT (user_id) DO NOTHING;

DROP POLICY IF EXISTS "team read" ON public.alertas_contatos;
DROP POLICY IF EXISTS "own insert" ON public.alertas_contatos;
DROP POLICY IF EXISTS "own update" ON public.alertas_contatos;
DROP POLICY IF EXISTS "own delete" ON public.alertas_contatos;
DROP POLICY IF EXISTS "allowed write" ON public.alertas_contatos;

CREATE POLICY "team read" ON public.alertas_contatos
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "allowed write" ON public.alertas_contatos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'user')
    )
  );