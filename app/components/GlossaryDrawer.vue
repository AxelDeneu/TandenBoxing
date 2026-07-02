<script setup lang="ts">
const { isOpen, current } = useGlossary()
</script>

<template>
  <UDrawer v-model:open="isOpen" :title="current?.label ?? ''">
    <template #body>
      <div class="space-y-4 pb-2">
        <p class="text-muted">{{ current?.definition }}</p>

        <div class="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <p class="mb-1 flex items-center gap-1.5 font-semibold text-primary">
            <UIcon name="i-lucide-target" class="size-4" /> Comment faire
          </p>
          <p class="text-muted">{{ current?.howTo }}</p>
        </div>
      </div>
    </template>
  </UDrawer>
</template>
