import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type {
  PreferenceAction,
  PreferenceEventContext,
  PreferenceEventSource,
  PreferenceReasonCode,
  PreferenceScope,
  PreferenceSignalKind,
} from '../../shared/exercise-preferences'
import type {
  BodyArea,
  SessionAdaptationCause,
  SessionAdaptationChange,
  SessionAdaptationCursor,
  SessionAutoregulationConstraints,
  SessionIntention,
} from '../../shared/session-autoregulation'
import type {
  GenerationErrorKind,
  GenerationJobRequest,
  GenerationJobSource,
  GenerationJobStatus,
  GenerationReuseKind,
} from '../../shared/generation-jobs'
import type { WorkoutSession } from '../../shared/session-schema'

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}

/**
 * Réglages applicatifs — ligne unique (id = 1).
 */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey().default(1),
  /** Jours d'entraînement, ISO (1 = lundi … 7 = dimanche). */
  trainingDays: text('training_days', { mode: 'json' })
    .$type<number[]>()
    .notNull()
    .default(sql`'[1,3,5]'`),
  /** Heure de génération de la séance (HH:mm, fuseau `timezone`). */
  generationTime: text('generation_time').notNull().default('07:00'),
  /** Durée cible d'une séance (minutes). */
  targetDurationMin: integer('target_duration_min').notNull().default(45),
  timezone: text('timezone').notNull().default('Europe/Paris'),
  aiModel: text('ai_model').notNull().default('claude-opus-4-8'),
  weightTrackingEnabled: integer('weight_tracking_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  /** Interrupteur d'authentification (désactivé par défaut). */
  authEnabled: integer('auth_enabled', { mode: 'boolean' }).notNull().default(false),
  onboardingCompleted: integer('onboarding_completed', { mode: 'boolean' })
    .notNull()
    .default(false),
  ...timestamps,
})

/**
 * Profil sportif issu du questionnaire d'accueil — ligne unique (id = 1).
 */
export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey().default(1),
  discipline: text('discipline').notNull().default('boxe-anglaise'),
  /** debutant | intermediaire | avance */
  level: text('level').notNull().default('debutant'),
  goal: text('goal').notNull().default('cardio-perte-de-gras'),
  /** sedentaire | actif | sportif */
  fitnessLevel: text('fitness_level'),
  /** Expérience libre (ex: « jamais fait de boxe », « cours il y a 2 ans »). */
  experience: text('experience'),
  age: integer('age'),
  heightCm: integer('height_cm'),
  equipment: text('equipment', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'["gants","bandes"]'`),
  /** Contraintes / blessures / limitations (texte libre injecté dans le contexte IA). */
  constraints: text('constraints'),
  notes: text('notes'),
  ...timestamps,
})

/**
 * Séances (une par date d'entraînement).
 */
export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Date de la séance au format YYYY-MM-DD (fuseau utilisateur). */
  date: text('date').notNull().unique(),
  /** planned | generated | in_progress | completed | skipped */
  status: text('status').notNull().default('generated'),
  title: text('title').notNull(),
  /**
   * Catégorie (type) de la séance : apprentissage | renforcement | enchainement |
   * cardio | recuperation. Nullable pour les séances générées avant l'ajout du champ.
   */
  category: text('category'),
  focus: text('focus').notNull(),
  summary: text('summary').notNull(),
  coachNote: text('coach_note').notNull().default(''),
  targetDurationMin: integer('target_duration_min').notNull(),
  estimatedDurationMin: integer('estimated_duration_min').notNull(),
  /** Structure complète de la séance (blocs / exercices / intervalles). */
  structure: text('structure', { mode: 'json' }).$type<WorkoutSession>().notNull(),
  aiModel: text('ai_model').notNull(),
  /** Origine et empreinte du contexte, nécessaires à l'invalidation des séances anticipées. */
  generationSource: text('generation_source').notNull().default('model'),
  generationContextHash: text('generation_context_hash'),
  fallbackUsed: integer('fallback_used', { mode: 'boolean' }).notNull().default(false),
  reusedFromSessionId: integer('reused_from_session_id'),
  /** Contexte envoyé au modèle (traçabilité / debug). */
  generationContext: text('generation_context', { mode: 'json' }).$type<unknown>(),
  generatedAt: integer('generated_at', { mode: 'timestamp' }),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  actualDurationSec: integer('actual_duration_sec'),
  ...timestamps,
})

/**
 * Feedback global d'une séance (une ligne par séance).
 */
export const sessionFeedback = sqliteTable('session_feedback', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(true),
  /** Difficulté ressentie globale 1-5 (RPE simplifié). */
  overallDifficulty: integer('overall_difficulty'),
  /** Niveau d'énergie 1-5. */
  energyLevel: integer('energy_level'),
  /** Zones de courbatures (ex: ["épaules","mollets"]). */
  soreness: text('soreness', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** Plaisir / motivation 1-5. */
  enjoyment: integer('enjoyment'),
  comment: text('comment'),
  actualDurationSec: integer('actual_duration_sec'),
  /** Nombre de blocs distincts dont une phase d'effort a été ignorée dans le timer. */
  skippedBlockCount: integer('skipped_block_count'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * Feedback par exercice (plusieurs lignes par séance).
 */
export const exerciseFeedback = sqliteTable('exercise_feedback', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  blockIndex: integer('block_index').notNull(),
  exerciseIndex: integer('exercise_index').notNull(),
  /** Nom dénormalisé pour le contexte IA sans re-parser la structure. */
  exerciseName: text('exercise_name').notNull(),
  /** Difficulté ressentie 1-5. */
  difficulty: integer('difficulty'),
  comment: text('comment'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * Journal des corrections explicites par exercice. Les motifs et le contexte sont bornés :
 * aucun commentaire libre ni donnée de santé détaillée n'est recopié dans ce journal.
 */
export const exercisePreferenceEvents = sqliteTable(
  'exercise_preference_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    exerciseKey: text('exercise_key').notNull(),
    exerciseName: text('exercise_name').notNull(),
    movementFamily: text('movement_family').notNull(),
    modality: text('modality').notNull(),
    action: text('action').$type<PreferenceAction>().notNull(),
    reasonCode: text('reason_code').$type<PreferenceReasonCode>().notNull(),
    signalKind: text('signal_kind').$type<PreferenceSignalKind>().notNull(),
    scope: text('scope').$type<PreferenceScope>().notNull(),
    scopeKey: text('scope_key').notNull(),
    occurredOn: text('occurred_on').notNull(),
    source: text('source').$type<PreferenceEventSource>().notNull(),
    /** Clé idempotente pour un feedback réenregistré ; null pour les actions ponctuelles. */
    sourceKey: text('source_key'),
    context: text('context', { mode: 'json' }).$type<PreferenceEventContext>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('exercise_preference_events_source_key_unique').on(table.sourceKey),
    index('exercise_preference_events_exercise_key_idx').on(table.exerciseKey),
    index('exercise_preference_events_occurred_on_idx').on(table.occurredOn),
  ],
)

/** Check-in facultatif et structuré effectué juste avant une séance. */
export const sessionCheckIns = sqliteTable('session_check_ins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  availableTimeMin: integer('available_time_min'),
  energy: integer('energy').notNull().default(3),
  sorenessLevel: integer('soreness_level').notNull().default(0),
  sorenessLocations: text('soreness_locations', { mode: 'json' })
    .$type<BodyArea[]>()
    .notNull()
    .default(sql`'[]'`),
  painLocations: text('pain_locations', { mode: 'json' })
    .$type<BodyArea[]>()
    .notNull()
    .default(sql`'[]'`),
  intention: text('intention').$type<SessionIntention>().notNull().default('maintain'),
  ...timestamps,
})

/** Journal append-only des décisions d'autorégulation avant et pendant l'effort. */
export const sessionAdaptations = sqliteTable(
  'session_adaptations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    sessionDate: text('session_date').notNull(),
    cause: text('cause').$type<SessionAdaptationCause>().notNull(),
    cursor: text('cursor', { mode: 'json' }).$type<SessionAdaptationCursor | null>(),
    constraints: text('constraints', { mode: 'json' })
      .$type<SessionAutoregulationConstraints>()
      .notNull(),
    changes: text('changes', { mode: 'json' }).$type<SessionAdaptationChange[]>().notNull(),
    beforeDurationSec: integer('before_duration_sec').notNull(),
    afterDurationSec: integer('after_duration_sec').notNull(),
    beforeIntensity: integer('before_intensity').notNull(),
    afterIntensity: integer('after_intensity').notNull(),
    ruleVersion: text('rule_version').notNull(),
    safetyNoticeShown: integer('safety_notice_shown', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('session_adaptations_session_id_idx').on(table.sessionId),
    index('session_adaptations_session_date_idx').on(table.sessionDate),
  ],
)

/**
 * Intention de planification d'une séance (une par date), découplée de la séance générée.
 * Permet de planifier à l'avance une catégorie + un focus : la séance complète est générée
 * le jour J (ou à la demande) en tenant compte de cette intention.
 */
export const sessionPlans = sqliteTable('session_plans', {
  /** Date planifiée au format YYYY-MM-DD (fuseau utilisateur). */
  date: text('date').primaryKey(),
  /**
   * Catégorie voulue : apprentissage | renforcement | enchainement | cardio | recuperation.
   * Null = laissée au choix de l'IA (séance sur mesure).
   */
  category: text('category'),
  /** Focus (thème) voulu ; null = laissé au choix de l'IA. */
  focus: text('focus'),
  /** Compétence suggérée au planner ; le moteur peut l'accepter, l'adapter ou la reporter. */
  requestedSkillId: text('requested_skill_id'),
  /** Thème libre d'une séance sur mesure (ex : « pectoraux », « biceps ») ; prime sur `focus`. */
  customFocus: text('custom_focus'),
  /** Durée voulue pour CETTE séance (minutes) ; null = durée cible des réglages. */
  durationMin: integer('duration_min'),
  /** Note libre de l'utilisateur (intention, contrainte du jour…). */
  note: text('note'),
  ...timestamps,
})

/**
 * Suivi optionnel du poids corporel.
 */
export const weights = sqliteTable('weights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull().unique(),
  weightKg: real('weight_kg').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * Dates dont la séance a été volontairement supprimée ou déplacée : la génération
 * automatique (cron, ouverture de l'appli) ne recrée rien pour ces dates.
 * Une génération explicite (bouton) lève le marqueur.
 */
export const dismissedDates = sqliteTable('dismissed_dates', {
  date: text('date').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * Journal des appels au modèle (append-only) : un enregistrement par appel Anthropic.
 * Survit à la régénération d'une séance et couvre tous les types d'appel (séance,
 * exercice, ajustement). Sert la vue « conso » (agrégats par mois / modèle / type).
 */
export const aiUsage = sqliteTable('ai_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Date de la séance concernée (YYYY-MM-DD) ou null pour un appel hors séance. */
  sessionDate: text('session_date'),
  /** Type d'appel : seance | exercice | ajustement. */
  kind: text('kind').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  /** Tokens écrits dans le cache (facturés ~1,25×). */
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  /** Tokens servis depuis le cache (facturés ~0,1×). */
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * File durable de génération. La clé unique porte sur la date et l'empreinte fonctionnelle :
 * deux processus ne peuvent donc pas créer deux générations concurrentes du même contenu.
 */
export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionDate: text('session_date').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    contextHash: text('context_hash').notNull(),
    request: text('request', { mode: 'json' }).$type<GenerationJobRequest>().notNull(),
    source: text('source').$type<GenerationJobSource>().notNull(),
    status: text('status').$type<GenerationJobStatus>().notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
    lastErrorKind: text('last_error_kind').$type<GenerationErrorKind>(),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    actionableMessage: text('actionable_message'),
    modelCalls: integer('model_calls').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd'),
    durationMs: integer('duration_ms'),
    providerLatencyMs: integer('provider_latency_ms').notNull().default(0),
    reuseKind: text('reuse_kind').$type<GenerationReuseKind>().notNull().default('none'),
    reusedBlockCount: integer('reused_block_count').notNull().default(0),
    fallbackUsed: integer('fallback_used', { mode: 'boolean' }).notNull().default(false),
    policyCorrectionCount: integer('policy_correction_count'),
    policyCompliant: integer('policy_compliant', { mode: 'boolean' }),
    queuedAt: integer('queued_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    failedAt: integer('failed_at', { mode: 'timestamp' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('generation_jobs_idempotency_key_unique').on(table.idempotencyKey),
    index('generation_jobs_session_date_idx').on(table.sessionDate),
    index('generation_jobs_dispatch_idx').on(table.status, table.nextAttemptAt),
  ],
)

/** Un essai par prise de lease : conserve l'historique des retries et de leurs erreurs. */
export const generationJobAttempts = sqliteTable(
  'generation_job_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull().default('running'),
    errorKind: text('error_kind').$type<GenerationErrorKind>(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    backoffMs: integer('backoff_ms'),
    modelCalls: integer('model_calls').notNull().default(0),
    durationMs: integer('duration_ms'),
    startedAt: integer('started_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => [
    uniqueIndex('generation_job_attempts_job_attempt_unique').on(table.jobId, table.attemptNumber),
    index('generation_job_attempts_job_id_idx').on(table.jobId),
  ],
)

export type Settings = typeof settings.$inferSelect
export type NewSettings = typeof settings.$inferInsert
export type Profile = typeof profile.$inferSelect
export type NewProfile = typeof profile.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type SessionFeedback = typeof sessionFeedback.$inferSelect
export type NewSessionFeedback = typeof sessionFeedback.$inferInsert
export type ExerciseFeedback = typeof exerciseFeedback.$inferSelect
export type NewExerciseFeedback = typeof exerciseFeedback.$inferInsert
export type ExercisePreferenceEventRow = typeof exercisePreferenceEvents.$inferSelect
export type NewExercisePreferenceEventRow = typeof exercisePreferenceEvents.$inferInsert
export type SessionCheckInRow = typeof sessionCheckIns.$inferSelect
export type NewSessionCheckInRow = typeof sessionCheckIns.$inferInsert
export type SessionAdaptationRow = typeof sessionAdaptations.$inferSelect
export type NewSessionAdaptationRow = typeof sessionAdaptations.$inferInsert
export type Weight = typeof weights.$inferSelect
export type NewWeight = typeof weights.$inferInsert
export type SessionPlan = typeof sessionPlans.$inferSelect
export type NewSessionPlan = typeof sessionPlans.$inferInsert
export type AiUsage = typeof aiUsage.$inferSelect
export type NewAiUsage = typeof aiUsage.$inferInsert
export type GenerationJob = typeof generationJobs.$inferSelect
export type NewGenerationJob = typeof generationJobs.$inferInsert
export type GenerationJobAttempt = typeof generationJobAttempts.$inferSelect
export type NewGenerationJobAttempt = typeof generationJobAttempts.$inferInsert
