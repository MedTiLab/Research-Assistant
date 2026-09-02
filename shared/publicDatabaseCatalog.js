function normalizeDbToken(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match catalog entries in free text (title/abstract/hint), same rules as PubMed variable discovery.
 * @param {string} text
 * @returns {string[]} canonical labels from {@link PUBLIC_DATABASE_CATALOG}
 */
export function inferDatabaseFamiliesFromText(text = '') {
  const source = String(text || '').trim();
  if (!source) return [];
  const hits = PUBLIC_DATABASE_CATALOG
    .filter((item) => item.aliases.some((term) => {
      try {
        return new RegExp(`\\b${escapeRegExp(term).replace(/\s+/g, '\\s+')}\\b`, 'i').test(source);
      } catch {
        return false;
      }
    }))
    .map((item) => item.label);
  return [...new Set(hits)];
}

function resolveExactCatalogLabel(raw) {
  const h = normalizeDbToken(raw);
  if (!h) return null;
  for (const item of PUBLIC_DATABASE_CATALOG) {
    if (normalizeDbToken(item.label) === h || normalizeDbToken(item.id) === h) return item.label;
    if (item.aliases.some((a) => normalizeDbToken(a) === h)) return item.label;
  }
  return null;
}

/**
 * Normalize LLM/rule outputs (e.g. "UKB", "MIMIC", "eICU") to canonical {@link PUBLIC_DATABASE_CATALOG} labels
 * (e.g. "UK Biobank", "MIMIC-IV", "eICU-CRD") so filters and the variable overview stay consistent.
 * Unknown fragments are dropped.
 * @param {unknown} hints
 * @returns {string[]}
 */
export function normalizeDatabaseFamilyLabels(hints) {
  if (!Array.isArray(hints)) return [];
  const seen = new Set();
  const out = [];
  const push = (label) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    out.push(label);
  };

  for (const raw of hints) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const segments = trimmed.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean);
    const parts = segments.length ? segments : [trimmed];

    for (const segment of parts) {
      const exact = resolveExactCatalogLabel(segment);
      if (exact) {
        push(exact);
        continue;
      }
      inferDatabaseFamiliesFromText(segment).forEach(push);
    }
  }
  return out;
}

export const PUBLIC_DATABASE_CATALOG = [
  {
    id: 'mimiciv',
    label: 'MIMIC-IV 1.0',
    aliases: ['MIMIC', 'MIMIC-IV', 'MIMIC-IV 1.0', 'mimiciv', 'Medical Information Mart for Intensive Care'],
    skillName: 'mimiciv-skill',
    family: 'ICU/EHR',
  },
  {
    id: 'mimiciv31',
    label: 'MIMIC-IV 3.1',
    aliases: ['MIMIC-IV 3.1', 'mimiciv31', 'MIMIC 3.1'],
    skillName: 'mimiciv31-skill',
    family: 'ICU/EHR',
  },
  {
    id: 'mimiciii',
    label: 'MIMIC-III',
    aliases: ['MIMIC-III', 'MIMIC-III 1.4', 'mimiciii'],
    skillName: 'mimiciii-skill',
    family: 'ICU/EHR',
  },
  {
    id: 'nwicu',
    label: 'NWICU',
    aliases: ['NWICU', 'Northwestern ICU', 'Northwestern ICU database', 'Northwestern Memorial HealthCare ICU'],
    skillName: 'nwicu-skill',
    family: 'ICU/EHR',
  },
  {
    id: 'eicu',
    label: 'eICU-CRD',
    aliases: ['eICU', 'eICU-CRD', 'eICU Collaborative Research Database'],
    skillName: 'eicu-skill',
    family: 'ICU/EHR',
  },
  {
    id: 'pic',
    label: 'PIC',
    aliases: ['PIC database', 'PICDB', 'Paediatric Intensive Care database', 'Pediatric Intensive Care Database'],
    skillName: 'pic-skill',
    family: 'ICU/EHR',
  },
  {
    id: 'sicdb',
    label: 'SICdb',
    aliases: ['SICdb', 'SICdb 1.0.8', 'Salzburg Intensive Care database'],
    skillName: 'sicdb-skill',
    family: 'ICU/EHR',
  },
  {
    id: 'inspire',
    label: 'INSPIRE',
    aliases: ['INSPIRE', 'INSPIRE Perioperative Medicine', 'perioperative medicine dataset'],
    skillName: 'inspire-skill',
    family: 'Perioperative EHR',
  },
  {
    id: 'ukb',
    label: 'UK Biobank',
    aliases: ['UK Biobank', 'UKB'],
    skillName: 'ukb-skill',
    family: 'Biobank/Survey',
  },
  {
    id: 'nhanes',
    label: 'NHANES',
    aliases: ['NHANES', 'National Health and Nutrition Examination Survey'],
    skillName: 'nhanes-skill',
    family: 'Biobank/Survey',
  },
  {
    id: 'elsa',
    label: 'ELSA',
    aliases: ['ELSA', 'English Longitudinal Study of Ageing'],
    skillName: 'elsa-skill',
    family: 'Aging cohort',
  },
  {
    id: 'hrs',
    label: 'HRS',
    aliases: ['HRS', 'Health and Retirement Study'],
    skillName: 'hrs-skill',
    family: 'Aging cohort',
  },
  {
    id: 'klosa',
    label: 'KLoSA',
    aliases: ['KLoSA', 'Korean Longitudinal Study of Aging'],
    skillName: 'klosa-skill',
    family: 'Aging cohort',
  },
  {
    id: 'lasi',
    label: 'LASI',
    aliases: ['LASI', 'Longitudinal Aging Study in India'],
    skillName: 'lasi-skill',
    family: 'Aging cohort',
  },
  {
    id: 'mhas',
    label: 'MHAS',
    aliases: ['MHAS', 'Mexican Health and Aging Study'],
    skillName: 'mhas-skill',
    family: 'Aging cohort',
  },
  {
    id: 'share',
    label: 'SHARE',
    aliases: ['SHARE', 'Survey of Health, Ageing and Retirement in Europe'],
    skillName: 'share-skill',
    family: 'Aging cohort',
  },
  {
    id: 'charls',
    label: 'CHARLS',
    aliases: ['CHARLS', 'China Health and Retirement Longitudinal Study'],
    skillName: 'charls-skill',
    family: 'Aging cohort',
  },
  {
    id: 'class',
    label: 'CLASS',
    aliases: ['CLASS', 'Chinese Longitudinal Aging Social Survey', '中国老年社会追踪调查'],
    skillName: 'class-skill',
    family: 'Aging cohort',
  },
  {
    id: 'clhls',
    label: 'CLHLS',
    aliases: ['CLHLS', 'Chinese Longitudinal Healthy Longevity Survey'],
    skillName: 'clhls-skill',
    family: 'Aging cohort',
  },
  {
    id: 'chns',
    label: 'CHNS',
    aliases: ['CHNS', 'China Health and Nutrition Survey'],
    skillName: 'chns-skill',
    family: 'Nutrition panel',
  },
  {
    id: 'cfps',
    label: 'CFPS',
    aliases: ['CFPS', 'China Family Panel Studies'],
    skillName: 'cfps-skill',
    family: 'China household/social survey',
  },
  {
    id: 'cgss',
    label: 'CGSS',
    aliases: ['CGSS', 'Chinese General Social Survey'],
    skillName: 'cgss-skill',
    family: 'China household/social survey',
  },
  {
    id: 'chfs',
    label: 'CHFS',
    aliases: ['CHFS', 'China Household Finance Survey'],
    skillName: 'chfs-skill',
    family: 'China household/social survey',
  },
  {
    id: 'chip',
    label: 'CHIP',
    aliases: ['CHIP', 'Chinese Household Income Project'],
    skillName: 'chip-skill',
    family: 'China household/social survey',
  },
  {
    id: 'clds',
    label: 'CLDS',
    aliases: ['CLDS', 'China Labor-force Dynamics Survey'],
    skillName: 'clds-skill',
    family: 'China household/social survey',
  },
  {
    id: 'css',
    label: 'CSS',
    aliases: ['CSS', 'Chinese Social Survey'],
    skillName: 'css-skill',
    family: 'China household/social survey',
  },
  {
    id: 'all-of-us',
    label: 'All of Us',
    aliases: ['All of Us', 'All of Us Research Program'],
    skillName: 'medhelp-database-api-access',
    family: 'Biobank/Survey',
  },
  {
    id: 'seer',
    label: 'SEER',
    aliases: ['SEER', 'Surveillance Epidemiology and End Results'],
    skillName: 'seer-skill',
    family: 'Registry',
  },
  {
    id: 'n3c',
    label: 'N3C',
    aliases: ['N3C', 'National COVID Cohort Collaborative'],
    skillName: 'medhelp-database-api-access',
    family: 'EHR network',
  },
];

export function getPublicDatabaseLabels() {
  return PUBLIC_DATABASE_CATALOG.map((item) => item.label);
}

export function getPublicDatabaseAliases(labels) {
  const selected = Array.isArray(labels) && labels.length > 0
    ? PUBLIC_DATABASE_CATALOG.filter((item) => labels.includes(item.label) || labels.includes(item.id))
    : PUBLIC_DATABASE_CATALOG;

  return selected.flatMap((item) => item.aliases);
}
