/*
  # Seed sample users

  Creates 8 sample team members across different departments with realistic
  job titles and specialisms relevant to a security/compliance RFP context.

  Each user is inserted into auth.users (with a placeholder encrypted password)
  and a corresponding user_profiles row. Skips creation if the email already
  exists to make the migration re-runnable.
*/

DO $$
DECLARE
  uid uuid;
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
  u jsonb;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(users_data)
  LOOP
    -- Skip if email already exists in auth.users
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = u->>'email') THEN
      uid := gen_random_uuid();

      INSERT INTO auth.users (
        id, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, aud, role
      ) VALUES (
        uid,
        u->>'email',
        crypt('SamplePass123!', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('display_name', u->>'display_name'),
        now(), now(),
        'authenticated', 'authenticated'
      );

      INSERT INTO user_profiles (id, display_name, job_title, department, expertise_tags, is_admin)
      VALUES (
        uid,
        u->>'display_name',
        u->>'job_title',
        u->>'department',
        ARRAY(SELECT jsonb_array_elements_text(u->'tags')),
        false
      )
      ON CONFLICT (id) DO NOTHING;

    ELSE
      -- User exists — ensure profile has job_title/department filled in
      SELECT id INTO uid FROM auth.users WHERE email = u->>'email';
      UPDATE user_profiles SET
        job_title  = COALESCE(NULLIF(job_title, ''),  u->>'job_title'),
        department = COALESCE(NULLIF(department, ''), u->>'department')
      WHERE id = uid;
    END IF;
  END LOOP;
END $$;
