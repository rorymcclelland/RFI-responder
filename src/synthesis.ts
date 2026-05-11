import { RetrievedSource, DraftResult } from './types';

const OPENERS = [
  'Based on our established security policies and practices,',
  'In accordance with our documented security framework,',
  'Our organization addresses this through a comprehensive approach:',
  'As outlined in our security documentation,',
  'Our security posture with respect to this area is as follows:',
];

const CLOSERS = [
  'We are committed to maintaining and continuously improving these controls as part of our ongoing security program.',
  'These practices are reviewed and updated regularly to align with evolving industry standards and regulatory requirements.',
  'All referenced policies are available for review under NDA upon request.',
  'Our security team is available to provide additional detail or clarification on any of the above points.',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomConfidence(): number {
  return Math.round((Math.random() * (0.95 - 0.65) + 0.65) * 100) / 100;
}

function extractKeyPoints(answer: string): string[] {
  return answer
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30);
}

export function synthesizeDraft(
  question: string,
  sources: RetrievedSource[]
): DraftResult {
  const topSources = sources.filter((s) => s.score > 0);
  const usedSources = topSources.length > 0 ? topSources : sources.slice(0, 2);

  const opener = pickRandom(OPENERS);
  const closer = pickRandom(CLOSERS);
  const citations = usedSources.map((s) => s.entry.id);

  const questionLower = question.toLowerCase();
  const isEncryption = /encrypt|tls|ssl|cipher|key management/i.test(questionLower);
  const isRetention = /retent|delet|purge|backup|storage/i.test(questionLower);
  const isAccess = /access|auth|password|login|sso|mfa|rbac|role/i.test(questionLower);
  const isIncident = /incident|breach|notify|response|soc|alert/i.test(questionLower);
  const isCompliance = /compli|certif|soc2|iso|gdpr|hipaa|audit/i.test(questionLower);
  const isVulnerability = /vulnerab|patch|scan|pentest|cve/i.test(questionLower);
  const isBCDR = /business continu|disaster|recovery|rto|rpo|availab/i.test(questionLower);
  const isVendor = /vendor|third.party|supply chain|sub.process/i.test(questionLower);

  let contextualIntro = '';
  if (isEncryption) contextualIntro = 'Regarding data encryption: ';
  else if (isRetention) contextualIntro = 'On the matter of data retention and deletion: ';
  else if (isAccess) contextualIntro = 'With respect to access control and authentication: ';
  else if (isIncident) contextualIntro = 'Concerning security incident management: ';
  else if (isCompliance) contextualIntro = 'Regarding our compliance posture: ';
  else if (isVulnerability) contextualIntro = 'With respect to vulnerability and patch management: ';
  else if (isBCDR) contextualIntro = 'On business continuity and disaster recovery: ';
  else if (isVendor) contextualIntro = 'Concerning third-party and vendor security: ';

  const bodyParagraphs: string[] = [];

  for (const source of usedSources) {
    const points = extractKeyPoints(source.entry.answer);
    if (points.length > 0) {
      bodyParagraphs.push(points.slice(0, 2).join('. ') + '.');
    }
  }

  const deduped = [...new Set(bodyParagraphs)];
  const body = deduped.join(' ');

  const draft = `${opener} ${contextualIntro}${body}\n\n${closer}\n\n[References: ${citations.join(', ')}]`;

  return {
    answer: draft,
    confidence: randomConfidence(),
    citations,
    sources: usedSources,
  };
}
