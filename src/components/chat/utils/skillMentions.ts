export interface SkillMentionCandidate {
  mention: string;
  name: string;
  dirPath: string;
  description?: string;
}

const KNOWN_SKILL_REFERENCE_PATTERN = /(^|[^A-Za-z0-9_$])([/$])([A-Za-z0-9][A-Za-z0-9_.:-]*)/gu;

export function normalizeSkillMentionCandidates(candidates: SkillMentionCandidate[]): SkillMentionCandidate[] {
  const seen = new Set<string>();
  return candidates
    .map((candidate) => ({
      ...candidate,
      mention: String(candidate.mention || '').trim(),
      name: String(candidate.name || candidate.mention || '').trim(),
      dirPath: String(candidate.dirPath || candidate.mention || '').trim(),
      description: candidate.description ? String(candidate.description).trim() : '',
    }))
    .filter((candidate) => candidate.mention && candidate.name && candidate.dirPath)
    .filter((candidate) => {
      const key = candidate.mention.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function extractKnownSkillReferences(
  text: string,
  candidates: SkillMentionCandidate[],
): SkillMentionCandidate[] {
  if (!text || candidates.length === 0) {
    return [];
  }

  const candidateByMention = new Map(
    candidates.map((candidate) => [candidate.mention.toLowerCase(), candidate]),
  );
  const references: SkillMentionCandidate[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  KNOWN_SKILL_REFERENCE_PATTERN.lastIndex = 0;
  while ((match = KNOWN_SKILL_REFERENCE_PATTERN.exec(text)) !== null) {
    const mention = match[3]?.toLowerCase();
    if (!mention || seen.has(mention)) {
      continue;
    }

    const candidate = candidateByMention.get(mention);
    if (!candidate) {
      continue;
    }

    seen.add(mention);
    references.push(candidate);
  }

  return references;
}

export function buildSkillReferenceContext(references: SkillMentionCandidate[]): string {
  if (references.length === 0) {
    return '';
  }

  const formattedReferences = references
    .map((reference) => {
      const label = reference.name && reference.name !== reference.mention
        ? `/${reference.mention} (${reference.name})`
        : `/${reference.mention}`;
      return `${label} -> .agents/skills/${reference.dirPath}/SKILL.md or .agents/skills/library/${reference.dirPath}/SKILL.md`;
    })
    .join('; ');

  return `[Context: The user explicitly referenced these Skill(s) with slash syntax: ${formattedReferences}. Treat them as requested skills and read the matching SKILL.md before executing when relevant.]`;
}
