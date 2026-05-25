-- Daily cron to delete expired, unverified COPPA gate rows.
-- Verified rows are already cleaned up by rpc_intake() on success.
-- Rows expire after 24 hours; without this, abandoned under-13 intake
-- attempts accumulate indefinitely (low priority at 1-10 client scale).
SELECT cron.schedule(
  'purge-intake-verifications',
  '0 4 * * *',
  $$
    DELETE FROM pending_intake_verifications
    WHERE expires_at < NOW() AND verified_at IS NULL;
  $$
);
