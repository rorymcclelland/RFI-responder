-- Development seed data. Loaded by `supabase db reset` (local) only; never by migrations,
-- so no real deployment gets these users or this data. All of it is synthetic.
--
-- Dev sign-in (local only): any of the emails below, password LocalDev2026pw
-- Sarah Chen is an admin; everyone else is a member.

DO $$
DECLARE
  uid uuid;
  u jsonb;
  users_data jsonb := '[
    {
      "email": "sarah.chen@example.com",
      "display_name": "Sarah Chen",
      "job_title": "Head of Information Security",
      "department": "Security",
      "tags": ["SOC 2","ISO 27001","risk management","governance","audit","compliance","GDPR","HIPAA"]
    },
    {
      "email": "james.okafor@example.com",
      "display_name": "James Okafor",
      "job_title": "Cloud Security Architect",
      "department": "Engineering",
      "tags": ["cloud security","AWS","Azure","GCP","zero trust","network security","firewall","VPN","encryption","TLS"]
    },
    {
      "email": "priya.sharma@example.com",
      "display_name": "Priya Sharma",
      "job_title": "Compliance Manager",
      "department": "Legal & Compliance",
      "tags": ["GDPR","CCPA","HIPAA","SOC 2","ISO 27001","audit","policy","data privacy","governance"]
    },
    {
      "email": "tom.richardson@example.com",
      "display_name": "Tom Richardson",
      "job_title": "Application Security Engineer",
      "department": "Engineering",
      "tags": ["application security","OWASP","SDLC","code review","penetration testing","vulnerability management","patch management"]
    },
    {
      "email": "maya.patel@example.com",
      "display_name": "Maya Patel",
      "job_title": "Identity & Access Manager",
      "department": "Security",
      "tags": ["access control","authentication","MFA","RBAC","SSO","identity","zero trust","privileged access"]
    },
    {
      "email": "daniel.webb@example.com",
      "display_name": "Daniel Webb",
      "job_title": "Security Operations Lead",
      "department": "Security Operations",
      "tags": ["incident response","security operations","SIEM","forensics","threat detection","SOC","monitoring"]
    },
    {
      "email": "lisa.huang@example.com",
      "display_name": "Lisa Huang",
      "job_title": "Data Protection Officer",
      "department": "Legal & Compliance",
      "tags": ["data privacy","GDPR","CCPA","data classification","data retention","encryption","AES-256","key management"]
    },
    {
      "email": "marcus.johnson@example.com",
      "display_name": "Marcus Johnson",
      "job_title": "Infrastructure Security Engineer",
      "department": "Engineering",
      "tags": ["network security","firewall","VPN","physical security","data center","business continuity","DR","patch management"]
    }
  ]';
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(users_data)
  LOOP
    SELECT id INTO uid FROM auth.users WHERE email = u->>'email';
    IF uid IS NULL THEN
      uid := gen_random_uuid();
      -- Empty strings (not NULL) for the token columns: GoTrue cannot read NULLs there.
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        u->>'email', crypt('LocalDev2026pw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('display_name', u->>'display_name'), now(), now(),
        '', '', '', ''
      );
      INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), uid, uid::text, 'email',
              jsonb_build_object('sub', uid::text, 'email', u->>'email', 'email_verified', true), now(), now(), now());
    END IF;

    -- The on_auth_user_created trigger has already created a bare profile; fill it in.
    UPDATE public.user_profiles SET
      display_name   = u->>'display_name',
      job_title      = u->>'job_title',
      department     = u->>'department',
      expertise_tags = ARRAY(SELECT jsonb_array_elements_text(u->'tags')),
      is_admin       = (u->>'email' = 'sarah.chen@example.com')
    WHERE id = uid;
  END LOOP;
END $$;
