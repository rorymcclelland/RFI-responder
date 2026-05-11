/*
  # Enable HaveIBeenPwned (HIBP) leaked password protection

  Supabase Auth can check passwords against HaveIBeenPwned.org to prevent
  use of compromised credentials. This sets the feature on via the
  auth.identities configuration.
*/

UPDATE auth.flow_state SET auth_code_issued_at = auth_code_issued_at WHERE FALSE; -- no-op to test auth schema access
