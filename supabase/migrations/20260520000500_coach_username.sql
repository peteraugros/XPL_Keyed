-- Coach username for the secret password-login surface.
--
-- /login normally only accepts email + magic link. Triple-tapping the
-- brand on /login reveals a hidden form that takes a username + password
-- and authenticates via Supabase signInWithPassword.
--
-- Why username + password instead of email + password: Tim doesn't want
-- to remember his email; he wants a quick credential pair. Username
-- maps to coach.email at lookup time; signInWithPassword runs against
-- email under the hood.

ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_coaches_username
  ON coaches (LOWER(username))
  WHERE username IS NOT NULL;

-- Seed Tim's coach row with the agreed-on username.
UPDATE coaches
SET username = 'timothyaugros'
WHERE display_name = 'Tim'
  AND username IS NULL;
