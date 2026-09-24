<script setup lang="ts">
import type { CalendarDay, SessionCategory } from '~/utils/session'
import { getCurriculumSkill, isSkillId, type SkillId } from '~~/shared/curriculum'

const props = defineProps<{ day: CalendarDay | null; suggestedSkillId?: SkillId | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()

const toast = useToast()

const session = computed(() => props.day?.session ?? null)
const plan = computed(() => props.day?.plan ?? null)
const generationJob = computed(() => props.day?.generationJob ?? null)
const date = computed(() => props.day?.date ?? '')

const showReschedule = ref(false)
const showRegen = ref(false)
const showDelete = ref(false)
const showDeletePlan = ref(false)
const editing = ref(false)
const loading = ref(false)

const dialogs = {
  reschedule: showReschedule,
  regenerate: showRegen,
  deleteSession: showDelete,
  deletePlan: showDeletePlan,
} as const

function setDialog(dialog: keyof typeof dialogs, visible: boolean): void {
  dialogs[dialog].value = visible
}

function startEditing(): void {
  editing.value = true
}

/** Catégorie affichée : celle de la séance, sinon celle de l'intention. */
const category = computed(() => session.value?.category ?? plan.value?.category ?? null)
const categoryMeta = computed(() =>
  category.value ? SESSION_CATEGORY_META[category.value as SessionCategory] : null,
)
const targetLabel = computed(() => {
  const id = plan.value?.requestedSkillId
  return isSkillId(id) ? getCurriculumSkill(id).label : null
})

const description = computed(() => {
  if (session.value) return 'Séance du jour'
  if (plan.value) return 'Séance planifiée — pas encore générée'
  return props.day?.isTrainingDay ? "Jour d'entraînement libre" : 'Jour de repos'
})

// Chaque ouverture (ou changement de jour) repart de l'état de consultation.
watch([open, date], () => {
  editing.value = false
})

function notifyError(e: any) {
  toast.add({
    title: 'Échec',
    description: e?.data?.statusMessage ?? e?.message ?? 'Erreur inconnue',
    color: 'error',
    icon: 'i-lucide-triangle-alert',
  })
}

/** Après toute mutation : la page rafraîchit le calendrier, le tiroir se referme. */
function done() {
  emit('changed')
  open.value = false
}

async function regenerate() {
  loading.value = true
  try {
    await $fetch('/api/sessions/generate', {
      method: 'POST',
      body: { date: date.value, regenerate: true },
    })
    showRegen.value = false
    toast.add({
      title: 'Régénération lancée',
      description: 'Nouvelle séance en préparation…',
      icon: 'i-lucide-loader-circle',
      color: 'info',
    })
    done()
  } catch (e) {
    notifyError(e)
  } finally {
    loading.value = false
  }
}

/** Génère la séance à partir de l'intention déjà enregistrée. */
async function generateFromPlan() {
  if (!plan.value) return
  loading.value = true
  try {
    await $fetch('/api/sessions/plan', {
      method: 'POST',
      body: {
        date: plan.value.date,
        category: plan.value.category,
        focus: plan.value.focus,
        requestedSkillId: plan.value.requestedSkillId,
        customFocus: plan.value.customFocus,
        durationMin: plan.value.durationMin,
        note: plan.value.note,
        generateNow: true,
      },
    })
    toast.add({
      title: 'Séance en préparation…',
      description: `Ton coach IA compose la séance du ${formatDateFr(date.value)}.`,
      icon: 'i-lucide-loader-circle',
      color: 'info',
    })
    done()
  } catch (e) {
    notifyError(e)
  } finally {
    loading.value = false
  }
}

async function retryGeneration() {
  if (!generationJob.value) return
  loading.value = true
  try {
    await $fetch('/api/generation-jobs/' + generationJob.value.id + '/retry', { method: 'POST' })
    toast.add({
      title: 'Relance enregistrée',
      description: 'Le job durable reprend avec trois nouvelles tentatives maximum.',
      icon: 'i-lucide-refresh-cw',
      color: 'info',
    })
    emit('changed')
  } catch (e) {
    notifyError(e)
  } finally {
    loading.value = false
  }
}

async function deleteSession() {
  loading.value = true
  try {
    await $fetch(`/api/sessions/${date.value}`, { method: 'DELETE' })
    showDelete.value = false
    toast.add({ title: 'Séance supprimée', icon: 'i-lucide-trash-2', color: 'success' })
    done()
  } catch (e) {
    notifyError(e)
  } finally {
    loading.value = false
  }
}

async function deletePlan() {
  loading.value = true
  try {
    await $fetch(`/api/sessions/${date.value}/plan`, { method: 'DELETE' })
    showDeletePlan.value = false
    toast.add({ title: 'Planification annulée', icon: 'i-lucide-calendar-off', color: 'success' })
    done()
  } catch (e) {
    notifyError(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="date ? capitalize(formatDateFr(date)) : ''"
    :description="description"
  >
    <template #body>
      <div v-if="day" class="space-y-5">
        <UAlert
          v-if="
            generationJob && ['queued', 'running', 'retry_scheduled'].includes(generationJob.status)
          "
          color="info"
          variant="soft"
          icon="i-lucide-loader-circle"
          :title="
            generationJob.status === 'retry_scheduled'
              ? 'Nouvelle tentative programmée'
              : 'Génération persistante en cours'
          "
          :description="
            'Tentative ' +
            generationJob.attemptCount +
            '/' +
            generationJob.maxAttempts +
            '. Le traitement reprendra automatiquement après un redémarrage.'
          "
          :ui="{ icon: 'animate-spin' }"
        />

        <UAlert
          v-else-if="generationJob?.status === 'failed'"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="Génération en échec"
          :description="
            generationJob.actionableMessage ?? 'Relance la génération lorsque tu es prêt.'
          "
        >
          <template #actions>
            <UButton size="sm" color="warning" :loading="loading" @click="retryGeneration">
              Relancer explicitement
            </UButton>
          </template>
        </UAlert>

        <!-- ── Une séance existe ── -->
        <template v-if="session">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                v-if="categoryMeta"
                color="neutral"
                variant="soft"
                :icon="categoryMeta.icon"
                :ui="{ leadingIcon: categoryMeta.iconClass }"
              >
                {{ categoryLabel(category) }}
              </UBadge>
              <UBadge color="primary" variant="soft" :icon="FOCUS_META[session.focus]?.icon">
                {{ focusLabel(session.focus) }}
              </UBadge>
              <UBadge
                v-if="session.status === 'completed'"
                color="success"
                variant="soft"
                icon="i-lucide-check"
              >
                Terminée
              </UBadge>
              <UBadge
                v-else-if="session.status === 'in_progress'"
                color="warning"
                variant="soft"
                icon="i-lucide-circle-play"
              >
                En cours
              </UBadge>
              <UBadge
                v-else-if="session.status === 'skipped'"
                color="neutral"
                variant="soft"
                icon="i-lucide-x"
              >
                Manquée
              </UBadge>
            </div>

            <h3 class="text-lg font-bold leading-tight">{{ session.title }}</h3>

            <p class="flex items-center gap-1.5 text-sm text-muted">
              <UIcon name="i-lucide-clock" class="size-4 text-primary" />
              {{ formatDuration(session.estimatedDurationMin * 60) }}
            </p>
          </div>

          <div class="space-y-2">
            <UButton
              block
              color="neutral"
              variant="soft"
              icon="i-lucide-eye"
              :to="`/seance/${date}`"
            >
              Voir la séance
            </UButton>

            <!-- Une séance terminée ne se relance pas depuis le planning : récap + détail suffisent. -->
            <template v-if="session.status !== 'completed'">
              <UButton block color="primary" icon="i-lucide-play" :to="`/seance/${date}/timer`">
                {{ session.status === 'in_progress' ? 'Reprendre' : 'Démarrer' }}
              </UButton>
              <UButton
                block
                color="neutral"
                variant="ghost"
                icon="i-lucide-calendar-clock"
                @click="setDialog('reschedule', true)"
              >
                Reporter
              </UButton>
              <UButton
                block
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                @click="setDialog('regenerate', true)"
              >
                Régénérer
              </UButton>
              <UButton
                block
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                @click="setDialog('deleteSession', true)"
              >
                Supprimer
              </UButton>
            </template>
          </div>
        </template>

        <!-- ── Intention enregistrée, séance pas encore générée ── -->
        <template v-else-if="plan && !editing">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                v-if="categoryMeta"
                color="neutral"
                variant="soft"
                :icon="categoryMeta.icon"
                :ui="{ leadingIcon: categoryMeta.iconClass }"
              >
                {{ categoryLabel(plan.category) }}
              </UBadge>
              <UBadge v-else color="neutral" variant="soft" icon="i-lucide-sparkles">
                Catégorie au choix de l'IA
              </UBadge>
              <UBadge
                v-if="plan.customFocus"
                color="primary"
                variant="soft"
                icon="i-lucide-pencil-line"
              >
                {{ plan.customFocus }}
              </UBadge>
              <UBadge
                v-else
                color="primary"
                variant="soft"
                :icon="plan.focus ? FOCUS_META[plan.focus]?.icon : 'i-lucide-sparkles'"
              >
                {{ plan.focus ? focusLabel(plan.focus) : "Focus au choix de l'IA" }}
              </UBadge>
              <UBadge v-if="plan.durationMin" color="neutral" variant="soft" icon="i-lucide-clock">
                {{ plan.durationMin }} min
              </UBadge>
              <UBadge v-if="targetLabel" color="primary" variant="outline" icon="i-lucide-route">
                Cible : {{ targetLabel }}
              </UBadge>
            </div>

            <p
              v-if="plan.note"
              class="rounded-lg border border-default bg-elevated p-3 text-sm text-muted"
            >
              « {{ plan.note }} »
            </p>

            <p class="text-sm text-muted">
              La séance sera générée automatiquement le jour venu — ou tout de suite si tu veux la
              découvrir en avance.
            </p>
          </div>

          <div class="space-y-2">
            <UButton
              block
              color="primary"
              icon="i-lucide-sparkles"
              :loading="loading"
              @click="generateFromPlan"
            >
              Générer maintenant
            </UButton>
            <UButton
              block
              color="neutral"
              variant="soft"
              icon="i-lucide-pencil"
              @click="startEditing"
            >
              Modifier
            </UButton>
            <UButton
              block
              color="neutral"
              variant="ghost"
              icon="i-lucide-calendar-clock"
              @click="setDialog('reschedule', true)"
            >
              Reporter
            </UButton>
            <UButton
              block
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              @click="setDialog('deletePlan', true)"
            >
              Annuler la planification
            </UButton>
          </div>
        </template>

        <!-- ── Rien de prévu (ou édition d'une intention) ── -->
        <template v-else>
          <UAlert
            v-if="!day.isTrainingDay && !editing"
            color="neutral"
            variant="soft"
            icon="i-lucide-bed"
            title="Jour de repos"
            description="Ce jour n'est pas dans tes jours d'entraînement — tu peux quand même y planifier une séance."
          />

          <PlanSessionForm
            :key="`${date}-${editing}`"
            :date="date"
            :initial="editing && plan ? plan : undefined"
            :suggested-skill-id="suggestedSkillId"
            @done="done"
          />
        </template>
      </div>
    </template>
  </USlideover>

  <!-- Report : déplace la séance (ou l'intention) vers une autre date. -->
  <RescheduleModal v-if="date" v-model:open="showReschedule" :date="date" @done="done" />

  <UModal
    v-model:open="showRegen"
    title="Régénérer la séance ?"
    description="La séance actuelle sera remplacée par une nouvelle proposition de l'IA (~20 s)."
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="setDialog('regenerate', false)">
          Annuler
        </UButton>
        <UButton color="primary" icon="i-lucide-refresh-cw" :loading="loading" @click="regenerate">
          Régénérer
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="showDelete"
    title="Supprimer la séance ?"
    description="Cette action est définitive : la séance et son feedback seront supprimés."
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="setDialog('deleteSession', false)">
          Annuler
        </UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="loading" @click="deleteSession">
          Supprimer
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="showDeletePlan"
    title="Annuler la planification ?"
    description="L'intention enregistrée pour ce jour sera supprimée. Aucune séance n'a encore été générée."
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="setDialog('deletePlan', false)">
          Annuler
        </UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="loading" @click="deletePlan">
          Supprimer
        </UButton>
      </div>
    </template>
  </UModal>
</template>
