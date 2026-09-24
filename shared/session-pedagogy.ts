import type { SkillId } from './curriculum'
import type { SkillPrescriptionGuidance } from './skill-mastery'

export interface PedagogicalSkill {
  id: SkillId
  label: string
}

export interface SessionPedagogicalIntent {
  worked: PedagogicalSkill[]
  consolidated: PedagogicalSkill[]
  introduced: PedagogicalSkill[]
  missingPrerequisites: PedagogicalSkill[]
  target: {
    skill: PedagogicalSkill
    decision: SkillPrescriptionGuidance['targetDecision']
    explanation: string
  } | null
  facts: string[]
  summary: string
  partial: boolean
}
