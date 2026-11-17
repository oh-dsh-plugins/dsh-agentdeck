import { readFileSync } from 'node:fs';
import { loadBuiltinAgents, loadBuiltinSkills } from './builtins.js';
import type { AgentDefinition, LocalizedText } from './types.js';

type PresentationLocale = { roles: Record<string, { inputs: string[]; deliverables: string[] }>; skills: Record<string, { title: string; description: string }> };
const locales = Object.fromEntries(['en', 'zh'].map(language => [language, JSON.parse(readFileSync(new URL('../../locale/' + language + '.json', import.meta.url), 'utf8')).presentation])) as Record<'en' | 'zh', PresentationLocale>;
const knownText = new Map<string, LocalizedText>();
for (const role of loadBuiltinAgents()) for (const field of ['inputs', 'deliverables'] as const) role[field].forEach((text, index) => {
  knownText.set(text, { en: text, zh: locales.zh.roles[role.id]?.[field][index] ?? text });
});
const skills = new Map(loadBuiltinSkills().map(skill => [skill.id, skill]));

/** Presentation only: canonical definitions, instructions and revisions stay unchanged. */
export function rolePresentation(role: AgentDefinition) {
  const translate = (text: string): LocalizedText => knownText.get(text) ?? { en: text, zh: text };
  return { inputs: role.inputs.map(translate), deliverables: role.deliverables.map(translate),
    skills: role.skills.map(id => ({ id,
      title: { en: locales.en.skills[id]?.title ?? id, zh: locales.zh.skills[id]?.title ?? id },
      description: { en: skills.get(id)?.description ?? '', zh: locales.zh.skills[id]?.description ?? skills.get(id)?.description ?? '' },
    })),
  };
}
