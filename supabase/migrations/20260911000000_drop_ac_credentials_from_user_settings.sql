-- The ActiveCampaign API key/base URL is a single shared credential for the
-- whole team, not per-user data — it now lives only as a server secret
-- (AC_API_KEY / AC_BASE_URL), read via process.env in src/lib/ac.functions.ts.
-- Storing it in the database meant it sat in plaintext, readable by anyone
-- with service-role/DB access. Drop it from user_settings entirely.

ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS ac_api_key,
  DROP COLUMN IF EXISTS ac_base_url;
