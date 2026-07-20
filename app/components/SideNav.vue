<script setup lang="ts">
// Navigation latérale desktop (≥ lg) — pendant de BottomNav, qui reste la nav mobile.
const route = useRoute()

const items = [
  { label: "Aujourd'hui", icon: 'i-lucide-dumbbell', to: '/' },
  { label: 'Planning', icon: 'i-lucide-calendar-days', to: '/planning' },
  { label: 'Historique', icon: 'i-lucide-history', to: '/historique' },
  { label: 'Glossaire', icon: 'i-lucide-book-open', to: '/glossaire' },
  { label: 'Stats', icon: 'i-lucide-chart-line', to: '/stats' },
  { label: 'Conso IA', icon: 'i-lucide-coins', to: '/conso' },
  { label: 'Réglages', icon: 'i-lucide-settings', to: '/reglages' },
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <aside
    class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-default bg-default lg:flex"
  >
    <NuxtLink to="/" class="flex items-center gap-2 px-5 py-6">
      <UIcon name="i-lucide-flame" class="size-6 shrink-0 text-primary" />
      <span class="text-lg font-bold leading-none">Tanden Boxing</span>
    </NuxtLink>

    <nav class="flex flex-col gap-1 px-3">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
        :class="
          isActive(item.to)
            ? 'bg-elevated text-primary'
            : 'text-muted hover:bg-elevated/50 hover:text-default'
        "
      >
        <UIcon :name="item.icon" class="size-5 shrink-0" />
        <span>{{ item.label }}</span>
      </NuxtLink>
    </nav>
  </aside>
</template>
