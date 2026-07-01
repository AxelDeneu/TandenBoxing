<script setup lang="ts">
import type { ApiSession } from '~/utils/session'

definePageMeta({ layout: false })
useHead({ title: 'Séance' })

const route = useRoute()
const date = route.params.date as string

const { data, pending, error } = await useFetch<ApiSession>(`/api/sessions/${date}`)
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

    <TimerRunner v-else :session="data.structure" :date="date" />
  </div>
</template>
