<script setup lang="ts">
const route = useRoute()

const items = [
  { label: "Aujourd'hui", icon: 'i-lucide-dumbbell', to: '/' },
  { label: 'Parcours', icon: 'i-lucide-route', to: '/progression' },
  { label: 'Planning', icon: 'i-lucide-calendar-days', to: '/planning' },
  { label: 'Historique', icon: 'i-lucide-history', to: '/historique' },
  { label: 'Stats', icon: 'i-lucide-chart-line', to: '/stats' },
  { label: 'Réglages', icon: 'i-lucide-settings', to: '/reglages' },
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <!-- Nav mobile uniquement : sur desktop, SideNav prend le relais. -->
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-default/85 backdrop-blur-lg lg:hidden"
  >
    <div class="mx-auto grid max-w-lg grid-cols-6">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :aria-current="isActive(item.to) ? 'page' : undefined"
        class="flex min-w-0 flex-col items-center gap-1 px-0.5 py-2.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:text-[11px]"
        :class="isActive(item.to) ? 'text-primary' : 'text-muted hover:text-default'"
      >
        <UIcon :name="item.icon" class="size-5" />
        <span class="w-full truncate text-center">{{ item.label }}</span>
      </NuxtLink>
    </div>
    <div :style="{ height: 'env(safe-area-inset-bottom)' }" />
  </nav>
</template>
