<script setup lang="ts">
import { monthGridDays, WEEKDAYS_FR } from '~~/shared/dates'
import type { CalendarDay, SessionCategory } from '~/utils/session'

const props = defineProps<{
  /** Jours renvoyés par /api/calendar (couvre au moins la grille affichée). */
  days: CalendarDay[]
  /** Date d'ancrage : le mois affiché. */
  anchor: string
  /** Date du jour (fuseau utilisateur) pour la mise en évidence. */
  today: string
}>()

defineEmits<{ select: [date: string] }>()

/** État visuel d'une case, dérivé de la séance et/ou de l'intention du jour. */
type CellKind = 'completed' | 'in_progress' | 'ready' | 'skipped' | 'plan' | 'free' | 'rest'

const KIND_CLASS: Record<CellKind, string> = {
  completed: 'border-success/30 bg-success/10',
  in_progress: 'border-warning/40 bg-warning/10',
  ready: 'border-default bg-elevated',
  skipped: 'border-default',
  plan: 'border-dashed border-primary/40 bg-primary/5',
  free: 'border-dashed border-default',
  rest: 'border-transparent',
}

const KIND_LABEL: Record<CellKind, string> = {
  completed: 'séance terminée',
  in_progress: 'séance en cours',
  ready: 'séance prête',
  skipped: 'séance manquée',
  plan: 'séance planifiée',
  free: "jour d'entraînement libre",
  rest: 'repos',
}

/** Initiales des jours de la semaine (L M M J V S D). */
const WEEKDAY_INITIALS = WEEKDAYS_FR.map((d) => d.charAt(0).toUpperCase())

function kindOf(day: CalendarDay | undefined): CellKind {
  if (!day) return 'rest'
  const status = day.session?.status
  if (status === 'completed') return 'completed'
  if (status === 'in_progress') return 'in_progress'
  if (status === 'skipped') return 'skipped'
  if (status) return 'ready' // generated | planned : séance prête à faire
  if (day.plan) return 'plan'
  return day.isTrainingDay ? 'free' : 'rest'
}

const cells = computed(() => {
  const byDate = new Map(props.days.map((d) => [d.date, d]))
  const prefix = props.anchor.slice(0, 7)

  return monthGridDays(props.anchor).map((date) => {
    const day = byDate.get(date)
    const kind = kindOf(day)
    const category = day?.session?.category ?? day?.plan?.category ?? null
    const meta = category ? SESSION_CATEGORY_META[category as SessionCategory] : undefined

    // Pastille d'état : couleur de catégorie quand on en a une, sinon icône de statut.
    let icon = meta?.icon ?? null
    let iconClass = meta?.iconClass ?? 'text-primary'
    if (kind === 'completed') {
      icon = 'i-lucide-check'
      iconClass = 'text-success'
    } else if (kind === 'in_progress') {
      icon = 'i-lucide-circle-play'
      iconClass = 'text-warning'
    } else if (kind === 'skipped') {
      icon = 'i-lucide-x'
      iconClass = 'text-dimmed'
    } else if (kind === 'rest') {
      icon = null
    } else if (kind === 'free') {
      icon = 'i-lucide-plus'
      iconClass = 'text-dimmed opacity-0 transition-opacity group-hover:opacity-100'
    } else if (!icon) {
      icon = 'i-lucide-dumbbell'
    }

    return {
      date,
      kind,
      icon,
      iconClass,
      number: Number(date.slice(8)),
      inMonth: date.slice(0, 7) === prefix,
      isToday: date === props.today,
      // Séance : son titre ; intention : le thème libre, sinon la catégorie visée.
      title:
        day?.session?.title ??
        (day?.plan
          ? (day.plan.customFocus ?? categoryLabel(day.plan.category) ?? 'Sur mesure')
          : null),
    }
  })
})

function ariaLabel(cell: { date: string; kind: CellKind; title: string | null }): string {
  const state = KIND_LABEL[cell.kind]
  return `${formatDateFr(cell.date)} — ${cell.title ? `${state} : ${cell.title}` : state}`
}
</script>

<template>
  <div>
    <!-- En-têtes des jours -->
    <div class="grid grid-cols-7 gap-1 lg:gap-1.5">
      <div
        v-for="(initial, i) in WEEKDAY_INITIALS"
        :key="i"
        class="pb-1 text-center text-xs font-medium text-dimmed"
      >
        {{ initial }}
      </div>
    </div>

    <!-- Grille du mois (6 semaines) -->
    <div class="grid grid-cols-7 gap-1 lg:gap-1.5">
      <button
        v-for="cell in cells"
        :key="cell.date"
        type="button"
        :aria-label="ariaLabel(cell)"
        :aria-current="cell.isToday ? 'date' : undefined"
        class="group flex min-h-14 flex-col items-center gap-1 rounded-lg border p-1 transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:min-h-24 lg:items-stretch lg:p-2"
        :class="[
          KIND_CLASS[cell.kind],
          !cell.inMonth && 'opacity-40',
          cell.isToday && 'ring-1 ring-primary',
        ]"
        @click="$emit('select', cell.date)"
      >
        <span
          class="text-xs font-semibold lg:text-sm"
          :class="cell.isToday ? 'text-primary' : cell.kind === 'rest' ? 'text-dimmed' : ''"
        >
          {{ cell.number }}
        </span>

        <UIcon
          v-if="cell.icon"
          :name="cell.icon"
          class="size-3.5 shrink-0"
          :class="cell.iconClass"
        />

        <!-- Titre court : seulement au large, où la place le permet -->
        <span
          v-if="cell.title"
          class="hidden text-left text-[11px] leading-tight text-muted lg:line-clamp-2"
          :class="cell.kind === 'skipped' && 'line-through'"
        >
          {{ cell.title }}
        </span>
      </button>
    </div>

    <!-- Légende -->
    <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-dimmed">
      <span class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full border border-success/30 bg-success/20" /> Terminée
      </span>
      <span class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full border border-default bg-elevated" /> Prête
      </span>
      <span class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full border border-dashed border-primary/50 bg-primary/10" />
        Planifiée
      </span>
      <span class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full border border-dashed border-default" /> Jour libre
      </span>
    </div>
  </div>
</template>
