-- Adiciona colunas de follow-up na tabela alertas_contatos
ALTER TABLE public.alertas_contatos
  ADD COLUMN IF NOT EXISTS followup_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultimo_followup_em TIMESTAMPTZ;
