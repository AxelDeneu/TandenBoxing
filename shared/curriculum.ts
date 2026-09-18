/**
 * Curriculum débutant de boxe anglaise.
 *
 * Les identifiants sont persistants : ils peuvent être stockés dans les séances et ne
 * doivent jamais être renommés sans stratégie de migration. Le numéro de version évolue
 * dès que le graphe ou le sens d'une compétence change.
 */

export const SKILL_IDS = [
  'posture_garde',
  'appuis',
  'jab',
  'cross',
  'un_deux',
  'crochets',
  'uppercuts',
  'defenses',
  'sorties_angle',
  'combinaisons_base',
] as const

export type SkillId = (typeof SKILL_IDS)[number]

export interface CurriculumSkill {
  id: SkillId
  label: string
  description: string
  prerequisites: readonly SkillId[]
  /** Focus historiques ou de planification auxquels la compétence contribue. */
  focuses: readonly string[]
}

export interface BeginnerCurriculum {
  id: 'boxe-anglaise-debutant'
  version: number
  skills: readonly CurriculumSkill[]
}

export const BEGINNER_CURRICULUM = {
  id: 'boxe-anglaise-debutant',
  version: 1,
  skills: [
    {
      id: 'posture_garde',
      label: 'Posture et garde',
      description: 'Stabilité, menton protégé, mains en place et retour systématique en garde.',
      prerequisites: [],
      focuses: ['fondations'],
    },
    {
      id: 'appuis',
      label: 'Appuis et déplacements',
      description: 'Se déplacer sans croiser les pieds et conserver une base stable.',
      prerequisites: ['posture_garde'],
      focuses: ['fondations', 'jeu_de_jambes'],
    },
    {
      id: 'jab',
      label: 'Jab',
      description: 'Direct du bras avant, retour rapide en garde et distance maîtrisée.',
      prerequisites: ['posture_garde'],
      focuses: ['fondations'],
    },
    {
      id: 'cross',
      label: 'Cross',
      description: 'Direct arrière avec rotation contrôlée et transfert de poids.',
      prerequisites: ['posture_garde', 'jab'],
      focuses: ['fondations', 'puissance'],
    },
    {
      id: 'un_deux',
      label: 'Enchaînement 1-2',
      description: 'Relier jab et cross sans perdre la garde, l’équilibre ni le rythme.',
      prerequisites: ['jab', 'cross'],
      focuses: ['fondations', 'combinaisons'],
    },
    {
      id: 'crochets',
      label: 'Crochets',
      description: 'Crochets avant et arrière avec rotation du buste et des appuis.',
      prerequisites: ['posture_garde', 'appuis'],
      focuses: ['crochets', 'corps', 'puissance'],
    },
    {
      id: 'uppercuts',
      label: 'Uppercuts',
      description: 'Uppercuts avant et arrière à courte distance, sans se redresser.',
      prerequisites: ['posture_garde', 'appuis'],
      focuses: ['uppercuts', 'corps'],
    },
    {
      id: 'defenses',
      label: 'Défenses de base',
      description: 'Blocages, parades et esquives simples avec retour en garde.',
      prerequisites: ['posture_garde', 'appuis'],
      focuses: ['defense'],
    },
    {
      id: 'sorties_angle',
      label: 'Sorties d’angle',
      description: 'Sortir de l’axe par un pas ou un pivot après une action.',
      prerequisites: ['appuis', 'defenses'],
      focuses: ['jeu_de_jambes', 'defense', 'combinaisons'],
    },
    {
      id: 'combinaisons_base',
      label: 'Combinaisons de base',
      description: 'Enchaîner au moins trois actions connues avec une sortie sûre.',
      prerequisites: ['un_deux', 'crochets', 'sorties_angle'],
      focuses: ['combinaisons'],
    },
  ],
} as const satisfies BeginnerCurriculum

const SKILL_ID_SET: ReadonlySet<string> = new Set(SKILL_IDS)
const SKILLS_BY_ID = new Map<SkillId, CurriculumSkill>(
  BEGINNER_CURRICULUM.skills.map((skill) => [skill.id, skill]),
)

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && SKILL_ID_SET.has(value)
}

export function getCurriculumSkill(id: SkillId): CurriculumSkill {
  return SKILLS_BY_ID.get(id)!
}

export function skillIdsForFocus(focus: string): SkillId[] {
  return BEGINNER_CURRICULUM.skills
    .filter((skill) => (skill.focuses as readonly string[]).includes(focus))
    .map((skill) => skill.id)
}

/** Retourne les erreurs structurelles du graphe ; une liste vide signifie qu'il est valide. */
export function validateCurriculum(curriculum: BeginnerCurriculum = BEGINNER_CURRICULUM): string[] {
  const errors: string[] = []
  const ids = curriculum.skills.map((skill) => skill.id)
  const declared = new Set(ids)

  if (new Set(ids).size !== ids.length)
    errors.push('Les identifiants de compétence sont dupliqués.')

  const missing = SKILL_IDS.filter((id) => !declared.has(id))
  const unknown = ids.filter((id) => !SKILL_ID_SET.has(id))
  if (missing.length) errors.push(`Compétences déclarées manquantes : ${missing.join(', ')}.`)
  if (unknown.length) errors.push(`Compétences inconnues : ${unknown.join(', ')}.`)

  for (const skill of curriculum.skills) {
    for (const prerequisite of skill.prerequisites) {
      if (!declared.has(prerequisite)) {
        errors.push(`Prérequis inconnu ${prerequisite} pour ${skill.id}.`)
      }
      if (prerequisite === skill.id) errors.push(`${skill.id} dépend d'elle-même.`)
    }
  }

  const visiting = new Set<SkillId>()
  const visited = new Set<SkillId>()
  const visit = (id: SkillId): void => {
    if (visiting.has(id)) {
      errors.push(`Cycle détecté autour de ${id}.`)
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    const skill = curriculum.skills.find((candidate) => candidate.id === id)
    for (const prerequisite of skill?.prerequisites ?? []) visit(prerequisite)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)

  return [...new Set(errors)]
}
