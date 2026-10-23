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

-- Starter knowledge base: eight synthetic security answers, added by the admin.
-- For a fuller set, sign in and import sample-data/security-qa.csv (100 synthetic Q&As).
INSERT INTO public.kb_entries (question, answer, tags, source, origin, origin_ref, created_by)
SELECT e->>'question', e->>'answer',
       ARRAY(SELECT jsonb_array_elements_text(e->'tags')), e->>'source',
       'seed', 'supabase/seed.sql',
       (SELECT id FROM auth.users WHERE email = 'sarah.chen@example.com')
FROM jsonb_array_elements('[
  {
    "question": "How does your company handle data encryption at rest and in transit?",
    "answer": "All data at rest is encrypted using AES-256 encryption. Data in transit is protected using TLS 1.2 or higher. Encryption keys are managed through a dedicated Key Management Service (KMS) with automatic rotation every 90 days. We maintain separate encryption keys per customer to ensure data isolation.",
    "tags": [
      "encryption",
      "data security",
      "AES-256",
      "TLS",
      "key management"
    ],
    "source": "Security Policy v3.2"
  },
  {
    "question": "What is your data retention and deletion policy?",
    "answer": "Customer data is retained for the duration of the contract plus 30 days post-termination. Upon contract end, all customer data is securely deleted within 30 days using DoD 5220.22-M multi-pass overwrite standards. Customers may request immediate deletion at any time. Deletion certificates are provided upon request. Backup copies are purged within 60 days of the primary deletion.",
    "tags": [
      "data retention",
      "data deletion",
      "compliance",
      "GDPR"
    ],
    "source": "Data Management Policy v2.1"
  },
  {
    "question": "How do you manage access control and user authentication?",
    "answer": "We enforce role-based access control (RBAC) with the principle of least privilege. Multi-factor authentication (MFA) is mandatory for all users with access to production systems. Single Sign-On (SSO) is supported via SAML 2.0 and OAuth 2.0. Access reviews are conducted quarterly, and all privileged access is logged and monitored. Dormant accounts are automatically disabled after 90 days of inactivity.",
    "tags": [
      "access control",
      "authentication",
      "MFA",
      "RBAC",
      "SSO"
    ],
    "source": "Access Management Policy v4.0"
  },
  {
    "question": "What certifications and compliance standards does your organization maintain?",
    "answer": "We maintain SOC 2 Type II certification (renewed annually), ISO 27001 certification, and are compliant with GDPR, CCPA, and HIPAA where applicable. Our most recent SOC 2 audit was completed in Q3 2024 with no material exceptions. Penetration testing is conducted annually by independent third-party firms. All audit reports are available under NDA upon request.",
    "tags": [
      "compliance",
      "SOC 2",
      "ISO 27001",
      "GDPR",
      "HIPAA",
      "certifications"
    ],
    "source": "Compliance Overview 2024"
  },
  {
    "question": "How does your company handle security incidents and breach notification?",
    "answer": "We maintain a 24/7 Security Operations Center (SOC) with automated alerting and a documented Incident Response Plan (IRP). In the event of a confirmed data breach affecting customer data, we notify affected customers within 72 hours as required by GDPR, and within 30 days as required by most US state laws. Our IRP is tested via tabletop exercises twice annually. A dedicated incident response team is on call at all times.",
    "tags": [
      "incident response",
      "breach notification",
      "security operations",
      "SOC"
    ],
    "source": "Incident Response Plan v5.1"
  },
  {
    "question": "What is your approach to vulnerability management and patch management?",
    "answer": "Critical and high vulnerabilities are remediated within 24 hours and 72 hours respectively. Medium vulnerabilities are addressed within 30 days. We conduct weekly automated vulnerability scans across all infrastructure components. Our patch management process follows a test-stage-production pipeline with mandatory change management approval for production changes. Emergency patches bypass the standard window with expedited approval.",
    "tags": [
      "vulnerability management",
      "patch management",
      "security scanning"
    ],
    "source": "Vulnerability Management Policy v2.3"
  },
  {
    "question": "How do you ensure business continuity and disaster recovery?",
    "answer": "We maintain a Recovery Time Objective (RTO) of 4 hours and a Recovery Point Objective (RPO) of 1 hour for critical systems. Our infrastructure is deployed across multiple availability zones in at least two geographic regions. Full disaster recovery tests are conducted semi-annually, with results documented and shared with enterprise customers. Data backups are performed every 15 minutes for databases and hourly for file storage, with off-site replication.",
    "tags": [
      "business continuity",
      "disaster recovery",
      "RTO",
      "RPO",
      "backup"
    ],
    "source": "Business Continuity Plan v3.0"
  },
  {
    "question": "How do you handle third-party vendor and supply chain security?",
    "answer": "All third-party vendors with access to customer data undergo a security assessment prior to engagement. Vendors are classified by risk tier (Critical, High, Medium, Low) and assessed accordingly. Critical and High-tier vendors undergo annual security reviews, penetration testing requirements, and must maintain SOC 2 Type II or equivalent. We maintain a complete inventory of sub-processors, which is available to customers. Supply chain security is reviewed as part of our annual risk assessment.",
    "tags": [
      "vendor management",
      "supply chain",
      "third-party risk",
      "sub-processors"
    ],
    "source": "Third-Party Risk Management Policy v1.8"
  }
]'::jsonb) AS e
ON CONFLICT DO NOTHING;

-- Two sample responses at different stages, owned by different people.
-- Due dates relative to the day the seed runs, so the overview shows one due soon.
INSERT INTO public.opportunities (name, due_date, created_by, owner_id)
SELECT v.name, current_date + v.days, u.id, u.id
FROM (VALUES
  ('Bluefin Freight (fictional): security questionnaire', 2,  'priya.sharma@example.com'),
  ('Larkspur Health (fictional): data platform RFI',      14, 'james.okafor@example.com')
) AS v(name, days, email)
JOIN auth.users u ON u.email = v.email
WHERE NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.name = v.name);
