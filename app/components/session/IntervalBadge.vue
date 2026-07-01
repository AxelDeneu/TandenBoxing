<script setup lang="ts">
defineProps<{ work: number; rest: number; rounds: number }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <UBadge color="primary" variant="soft" icon="i-lucide-zap" size="sm">
      {{ rounds }} × {{ work }}s
    </UBadge>
    <UBadge v-if="rest > 0" color="neutral" variant="soft" icon="i-lucide-pause" size="sm">
      {{ rest }}s repos
    </UBadge>
  </div>
</template>
