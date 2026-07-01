<script setup lang="ts">
const route = useRoute()

const items = [
  { label: "Aujourd'hui", icon: 'i-lucide-dumbbell', to: '/' },
  { label: 'Historique', icon: 'i-lucide-history', to: '/historique' },
  { label: 'Stats', icon: 'i-lucide-chart-line', to: '/stats' },
  { label: 'Réglages', icon: 'i-lucide-settings', to: '/reglages' },
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-default/85 backdrop-blur-lg"
  >
    <div class="mx-auto grid max-w-lg grid-cols-4">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors"
        :class="isActive(item.to) ? 'text-primary' : 'text-muted hover:text-default'"
      >
        <UIcon :name="item.icon" class="size-5" />
        <span>{{ item.label }}</span>
      </NuxtLink>
    </div>
    <div :style="{ height: 'env(safe-area-inset-bottom)' }" />
  </nav>
</template>
