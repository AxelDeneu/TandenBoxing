<script setup lang="ts">
import { SKILL_DISPLAY_STATES, type SkillDisplayState } from '~~/shared/skill-progression-api'

useHead({ title: 'Progression' })

const {
  data: progression,
  status,
  error,
  refresh,
} = await useAsyncData('skill-progression', () => loadSkillProgression((url) => $fetch(url)), {
  lazy: true,
})

const skillsByState = computed(
  () =>
    Object.fromEntries(
      SKILL_DISPLAY_STATES.map((state) => [
        state,
        progression.value?.skills.filter((skill) => skill.state === state) ?? [],
      ]),
    ) as Record<SkillDisplayState, NonNullable<typeof progression.value>['skills']>,
)

const CARD_CLASSES: Record<SkillDisplayState, string> = {
  acquired: 'border-success/30',
  consolidating: 'border-warning/30',
  eligible: 'border-primary/40 ring-1 ring-primary/10',
  blocked: 'border-default opacity-90',
}

function targetActionLabel(state: SkillDisplayState): string {
  if (state === 'eligible') return 'Cibler à la prochaine séance'
  if (state === 'blocked') return 'Progresser vers cette compétence'
  return 'Cibler pour consolider'
}
</script>

<template>
  <div class="space-y-6 p-4 lg:py-8">
    <header class="flex items-start gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        to="/"
        aria-label="Retour à la séance du jour"
      />
      <div class="min-w-0">
        <p class="text-xs uppercase tracking-wide text-dimmed">Parcours technique</p>
        <h1 class="text-pretty text-2xl font-bold">Ma progression</h1>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Comprends ce que tu maîtrises, ce que tu consolides et les prochaines étapes que le
          planner peut te proposer en sécurité.
        </p>
      </div>
    </header>

    <div
      v-if="status === 'pending' && !progression"
      class="space-y-4"
      role="status"
      aria-live="polite"
      aria-label="Chargement du parcours de progression"
    >
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <USkeleton v-for="index in 4" :key="index" class="h-20 rounded-xl" />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <USkeleton v-for="index in 6" :key="index" class="h-64 rounded-xl" />
      </div>
    </div>

    <UCard v-else-if="error" role="alert">
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-cloud-alert" class="size-10 text-error" />
        <div>
          <h2 class="font-semibold">Progression indisponible</h2>
          <p class="mt-1 text-sm text-muted">
            Impossible de charger ton parcours pour le moment. Tes données n’ont pas été modifiées.
          </p>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          :loading="status === 'pending'"
          @click="() => refresh()"
        >
          Réessayer
        </UButton>
      </div>
    </UCard>

    <template v-else-if="progression">
      <UAlert
        v-if="progression.partial"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Parcours partiellement disponible"
        :description="
          progression.dataQuality.warnings.join(' ') ||
          'Certaines compétences ne peuvent pas être affichées.'
        "
      />

      <UCard v-if="progression.skills.length === 0">
        <div class="flex flex-col items-center gap-3 py-10 text-center">
          <UIcon name="i-lucide-route" class="size-10 text-muted" />
          <div>
            <h2 class="font-semibold">Parcours encore vide</h2>
            <p class="mt-1 text-sm text-muted">
              Les compétences apparaîtront dès que le curriculum sera disponible.
            </p>
          </div>
          <UButton to="/" color="neutral" variant="soft">Retour à ma séance</UButton>
        </div>
      </UCard>

      <template v-else>
        <section aria-labelledby="progression-summary-title">
          <h2 id="progression-summary-title" class="sr-only">Résumé du parcours</h2>
          <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div
              v-for="state in SKILL_DISPLAY_STATES"
              :key="state"
              class="rounded-xl border border-default bg-elevated p-3"
            >
              <dt class="flex items-center gap-1.5 text-xs text-muted">
                <UIcon :name="SKILL_STATE_META[state].icon" class="size-4" />
                {{ SKILL_STATE_META[state].label }}
              </dt>
              <dd class="mt-1 text-2xl font-bold tabular-nums">
                {{ progression.summary[state] }}
              </dd>
            </div>
          </dl>
        </section>

        <UCard>
          <div class="flex items-start gap-3">
            <UIcon name="i-lucide-info" class="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 class="font-semibold">Comment une compétence devient acquise</h2>
              <p class="mt-1 text-sm text-muted">{{ progression.criteria.explanation }}</p>
              <p class="mt-2 text-xs text-dimmed">
                Calcul au {{ formatDateFr(progression.asOfDate) }} · curriculum v{{
                  progression.curriculum.version
                }}
              </p>
            </div>
          </div>
        </UCard>

        <section
          v-for="state in SKILL_DISPLAY_STATES"
          :key="state"
          class="space-y-3"
          :aria-labelledby="`skills-${state}`"
        >
          <div class="flex items-center gap-2">
            <UIcon :name="SKILL_STATE_META[state].icon" class="size-5 text-primary" />
            <h2 :id="`skills-${state}`" class="text-lg font-semibold">
              {{ SKILL_STATE_META[state].label }}
            </h2>
            <UBadge color="neutral" variant="soft">{{ skillsByState[state].length }}</UBadge>
          </div>

          <p v-if="!skillsByState[state].length" class="text-sm text-dimmed">
            Aucune compétence dans cet état.
          </p>

          <ol v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <li v-for="skill in skillsByState[state]" :key="skill.id" class="min-w-0">
              <article
                class="flex h-full flex-col rounded-xl border bg-default p-4"
                :class="CARD_CLASSES[state]"
                :aria-labelledby="`skill-${skill.id}`"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-xs text-dimmed">Étape {{ skill.order + 1 }}</p>
                    <h3 :id="`skill-${skill.id}`" class="break-words font-semibold">
                      {{ skill.label }}
                    </h3>
                  </div>
                  <UBadge
                    :color="SKILL_STATE_META[state].color"
                    variant="soft"
                    :icon="SKILL_STATE_META[state].icon"
                  >
                    {{ skill.stateLabel }}
                  </UBadge>
                </div>

                <p class="mt-3 text-sm text-muted">{{ skill.description }}</p>

                <div class="mt-4">
                  <div class="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span class="text-muted">{{ skill.progress.label }}</span>
                    <span aria-hidden="true">{{ skill.progress.percent }} %</span>
                  </div>
                  <progress
                    class="h-2 w-full accent-primary"
                    :value="skill.progress.percent"
                    max="100"
                    :aria-label="`Progression de ${skill.label} : ${skill.progress.label}`"
                  />
                </div>

                <div v-if="skill.missingPrerequisites.length" class="mt-4">
                  <p class="text-xs font-medium text-muted">Prérequis manquants</p>
                  <ul
                    class="mt-1 flex flex-wrap gap-1.5"
                    :aria-label="`Prérequis de ${skill.label}`"
                  >
                    <li v-for="prerequisite in skill.missingPrerequisites" :key="prerequisite.id">
                      <UBadge color="neutral" variant="outline" icon="i-lucide-lock-keyhole">
                        {{ prerequisite.label }}
                      </UBadge>
                    </li>
                  </ul>
                </div>

                <details class="mt-4 rounded-lg bg-elevated p-3 text-sm">
                  <summary
                    class="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Voir les critères et l’explication
                  </summary>
                  <p class="mt-2 text-muted">{{ skill.criteria }}</p>
                  <ul v-if="skill.reasons.length" class="mt-2 list-disc space-y-1 pl-5 text-muted">
                    <li v-for="reason in skill.reasons" :key="reason">{{ reason }}</li>
                  </ul>
                  <p class="mt-2 text-xs text-dimmed">{{ skill.targeting.explanation }}</p>
                </details>

                <UButton
                  class="mt-4 justify-center"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-calendar-plus"
                  :to="{ path: '/planning', query: { targetSkillId: skill.id } }"
                  :aria-label="`${targetActionLabel(state)} : ${skill.label}`"
                >
                  {{ targetActionLabel(state) }}
                </UButton>
              </article>
            </li>
          </ol>
        </section>
      </template>
    </template>
  </div>
</template>
