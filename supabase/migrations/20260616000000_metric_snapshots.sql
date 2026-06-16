-- Snapshots de métricas para comparar antes/depois de alterações
CREATE TABLE public.metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,            -- "Antes da alteração X", "Depois", etc.
  entity_type TEXT NOT NULL,      -- 'campaign' | 'automation'
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  metrics JSONB NOT NULL,         -- { open_rate, ctr, clicks, sends, ... }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.metric_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own snapshots select" ON public.metric_snapshots
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own snapshots insert" ON public.metric_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own snapshots delete" ON public.metric_snapshots
  FOR DELETE USING (auth.uid() = user_id);
