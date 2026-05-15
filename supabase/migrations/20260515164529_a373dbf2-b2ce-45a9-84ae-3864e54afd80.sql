
-- User settings: AC API key, base URL, benchmarks. One row per user.
CREATE TABLE public.user_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ac_api_key TEXT,
  ac_base_url TEXT NOT NULL DEFAULT 'https://gcbinvestimentos.api-us1.com/api/3/',
  benchmark_open_rate NUMERIC NOT NULL DEFAULT 22,
  benchmark_ctr NUMERIC NOT NULL DEFAULT 2.9,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own settings" ON public.user_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own settings" ON public.user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own settings" ON public.user_settings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users delete own settings" ON public.user_settings
  FOR DELETE USING (auth.uid() = user_id);

-- Cache for AI recommendations + variations per campaign per user (saves tokens on revisit)
CREATE TABLE public.campaign_ai_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'recommendations' | 'variations'
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, campaign_id, kind)
);
ALTER TABLE public.campaign_ai_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cache select" ON public.campaign_ai_cache
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own cache insert" ON public.campaign_ai_cache
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own cache update" ON public.campaign_ai_cache
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own cache delete" ON public.campaign_ai_cache
  FOR DELETE USING (auth.uid() = user_id);
