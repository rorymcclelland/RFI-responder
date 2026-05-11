import { KnowledgeEntry } from './types';

export const initialKnowledgeBase: KnowledgeEntry[] = [
  {
    id: 'KB-001',
    question: 'How does your company handle data encryption at rest and in transit?',
    answer:
      'All data at rest is encrypted using AES-256 encryption. Data in transit is protected using TLS 1.2 or higher. Encryption keys are managed through a dedicated Key Management Service (KMS) with automatic rotation every 90 days. We maintain separate encryption keys per customer to ensure data isolation.',
    tags: ['encryption', 'data security', 'AES-256', 'TLS', 'key management'],
    source: 'Security Policy v3.2',
  },
  {
    id: 'KB-002',
    question: 'What is your data retention and deletion policy?',
    answer:
      'Customer data is retained for the duration of the contract plus 30 days post-termination. Upon contract end, all customer data is securely deleted within 30 days using DoD 5220.22-M multi-pass overwrite standards. Customers may request immediate deletion at any time. Deletion certificates are provided upon request. Backup copies are purged within 60 days of the primary deletion.',
    tags: ['data retention', 'data deletion', 'compliance', 'GDPR'],
    source: 'Data Management Policy v2.1',
  },
  {
    id: 'KB-003',
    question: 'How do you manage access control and user authentication?',
    answer:
      'We enforce role-based access control (RBAC) with the principle of least privilege. Multi-factor authentication (MFA) is mandatory for all users with access to production systems. Single Sign-On (SSO) is supported via SAML 2.0 and OAuth 2.0. Access reviews are conducted quarterly, and all privileged access is logged and monitored. Dormant accounts are automatically disabled after 90 days of inactivity.',
    tags: ['access control', 'authentication', 'MFA', 'RBAC', 'SSO'],
    source: 'Access Management Policy v4.0',
  },
  {
    id: 'KB-004',
    question: 'What certifications and compliance standards does your organization maintain?',
    answer:
      'We maintain SOC 2 Type II certification (renewed annually), ISO 27001 certification, and are compliant with GDPR, CCPA, and HIPAA where applicable. Our most recent SOC 2 audit was completed in Q3 2024 with no material exceptions. Penetration testing is conducted annually by independent third-party firms. All audit reports are available under NDA upon request.',
    tags: ['compliance', 'SOC 2', 'ISO 27001', 'GDPR', 'HIPAA', 'certifications'],
    source: 'Compliance Overview 2024',
  },
  {
    id: 'KB-005',
    question: 'How does your company handle security incidents and breach notification?',
    answer:
      'We maintain a 24/7 Security Operations Center (SOC) with automated alerting and a documented Incident Response Plan (IRP). In the event of a confirmed data breach affecting customer data, we notify affected customers within 72 hours as required by GDPR, and within 30 days as required by most US state laws. Our IRP is tested via tabletop exercises twice annually. A dedicated incident response team is on call at all times.',
    tags: ['incident response', 'breach notification', 'security operations', 'SOC'],
    source: 'Incident Response Plan v5.1',
  },
  {
    id: 'KB-006',
    question: 'What is your approach to vulnerability management and patch management?',
    answer:
      'Critical and high vulnerabilities are remediated within 24 hours and 72 hours respectively. Medium vulnerabilities are addressed within 30 days. We conduct weekly automated vulnerability scans across all infrastructure components. Our patch management process follows a test-stage-production pipeline with mandatory change management approval for production changes. Emergency patches bypass the standard window with expedited approval.',
    tags: ['vulnerability management', 'patch management', 'security scanning'],
    source: 'Vulnerability Management Policy v2.3',
  },
  {
    id: 'KB-007',
    question: 'How do you ensure business continuity and disaster recovery?',
    answer:
      'We maintain a Recovery Time Objective (RTO) of 4 hours and a Recovery Point Objective (RPO) of 1 hour for critical systems. Our infrastructure is deployed across multiple availability zones in at least two geographic regions. Full disaster recovery tests are conducted semi-annually, with results documented and shared with enterprise customers. Data backups are performed every 15 minutes for databases and hourly for file storage, with off-site replication.',
    tags: ['business continuity', 'disaster recovery', 'RTO', 'RPO', 'backup'],
    source: 'Business Continuity Plan v3.0',
  },
  {
    id: 'KB-008',
    question: 'How do you handle third-party vendor and supply chain security?',
    answer:
      'All third-party vendors with access to customer data undergo a security assessment prior to engagement. Vendors are classified by risk tier (Critical, High, Medium, Low) and assessed accordingly. Critical and High-tier vendors undergo annual security reviews, penetration testing requirements, and must maintain SOC 2 Type II or equivalent. We maintain a complete inventory of sub-processors, which is available to customers. Supply chain security is reviewed as part of our annual risk assessment.',
    tags: ['vendor management', 'supply chain', 'third-party risk', 'sub-processors'],
    source: 'Third-Party Risk Management Policy v1.8',
  },
];
