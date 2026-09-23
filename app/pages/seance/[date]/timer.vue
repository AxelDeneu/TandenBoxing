<script setup lang="ts">
import type { SessionCheckIn } from '~~/shared/session-autoregulation'
import type { ApiSession } from '~/utils/session'

definePageMeta({ layout: false })
useHead({ title: 'Séance' })

const route = useRoute()
const date = route.params.date as string

interface TimerSessionResponse extends ApiSession {
  checkIn: { id: number } | null
}

const { data, pending, error } = await useFetch<TimerSessionResponse>(`/api/sessions/${date}`)
const session = ref<ApiSession | null>(data.value ?? null)
const checkInLoading = ref(false)
const safetyNotice = ref<string | null>(null)
const ready = ref(
  Boolean(
    data.value &&
    (data.value.checkIn ||
      data.value.status === 'in_progress' ||
      data.value.status === 'completed'),
  ),
)
const toast = useToast()

function errorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Erreur inconnue'
  const candidate = error as { data?: { statusMessage?: unknown }; message?: unknown }
  if (typeof candidate.data?.statusMessage === 'string') return candidate.data.statusMessage
  if (typeof candidate.message === 'string') return candidate.message
  return 'Erreur inconnue'
}

async function submitCheckIn(checkIn: SessionCheckIn): Promise<void> {
  checkInLoading.value = true
  try {
    const result = await $fetch<{
      session: ApiSession
      safetyNotice: string | null
    }>(`/api/sessions/${date}/check-in`, {
      method: 'POST',
      body: checkIn,
    })
    session.value = result.session
    safetyNotice.value = result.safetyNotice
    ready.value = true
  } catch (error: unknown) {
    toast.add({
      title: 'Check-in non appliqué',
      description: errorMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    checkInLoading.value = false
  }
}

function skipCheckIn(): void {
  ready.value = true
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-white">
    <div v-if="pending" class="fixed inset-0 flex items-center justify-center">
      <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin opacity-70" />
    </div>

    <div
      v-else-if="error || !data"
      class="fixed inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <UIcon name="i-lucide-triangle-alert" class="size-12 text-amber-400" />
      <p>Séance introuvable.</p>
      <UButton to="/" color="neutral" variant="soft">Retour à l'accueil</UButton>
    </div>

    <SessionCheckInCard
      v-else-if="session && !ready"
      :duration-min="session.estimatedDurationMin"
      :loading="checkInLoading"
      @submit="submitCheckIn"
      @skip="skipCheckIn"
    />

    <TimerRunner
      v-else-if="session"
      :session="session.structure"
      :date="date"
      :initial-safety-notice="safetyNotice"
    />
  </div>
</template>
