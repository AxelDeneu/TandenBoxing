<script setup lang="ts">
const props = defineProps<{ date: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ done: [newDate: string] }>()

const toast = useToast()
const newDate = ref('')
const loading = ref(false)

watch(open, (isOpen) => {
  if (isOpen) newDate.value = addDaysIso(props.date, 1)
})

async function submit() {
  if (!newDate.value) return
  loading.value = true
  try {
    await $fetch(`/api/sessions/${props.date}/reschedule`, {
      method: 'POST',
      body: { newDate: newDate.value },
    })
    open.value = false
    toast.add({
      title: 'Séance reportée',
      description: `Déplacée au ${formatDateFr(newDate.value)}.`,
      icon: 'i-lucide-calendar-check',
      color: 'success',
    })
    emit('done', newDate.value)
  } catch (e: any) {
    toast.add({
      title: 'Échec',
      description: e?.data?.statusMessage ?? e?.message,
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Reporter la séance"
    description="Choisis la nouvelle date de cette séance."
  >
    <template #body>
      <UInput v-model="newDate" type="date" class="w-full" />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">Annuler</UButton>
        <UButton color="primary" icon="i-lucide-calendar-check" :loading="loading" @click="submit">
          Reporter
        </UButton>
      </div>
    </template>
  </UModal>
</template>
