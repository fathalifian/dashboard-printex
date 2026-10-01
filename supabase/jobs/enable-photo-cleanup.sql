-- Run after photo-cleanup.sql and after adding the two documented Vault secrets.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
-- Requests briefly contain the server API key until dispatched.
REVOKE ALL ON net.http_request_queue FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name IN ('printex_storage_url','printex_storage_cleanup_key')) <> 2 THEN
    RAISE EXCEPTION 'Configure photo cleanup Vault secrets first';
  END IF;
  IF to_regprocedure('public.printex_run_photo_cleanup()') IS NULL THEN
    RAISE EXCEPTION 'Install photo-cleanup.sql first';
  END IF;
END $$;
SELECT cron.schedule('printex-photo-cleanup','*/5 * * * *','SELECT public.printex_run_photo_cleanup();');
COMMIT;
