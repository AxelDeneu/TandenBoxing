<script setup lang="ts">
import { GLOSSARY, GLOSSARY_GROUPS } from '~~/shared/glossary'

useHead({ title: 'Glossaire' })

const query = ref('')

/** Normalise pour une recherche insensible aux accents et à la casse. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

const groups = computed(() => {
  const q = normalize(query.value.trim())
  return GLOSSARY_GROUPS.map((group) => {
    const entries = group.keys
      .map((key) => ({ key, entry: GLOSSARY[key]! }))
      .filter(({ entry }) => {
        if (!q) return true
        return normalize(`${entry.label} ${entry.definition}`).includes(q)
      })
    return { ...group, entries }
  }).filter((group) => group.entries.length > 0)
})

const totalMatches = computed(() => groups.value.reduce((n, g) => n + g.entries.length, 0))
</script>

<template>
  <div class="space-y-5 p-4">
    <header>
      <h1 class="text-2xl font-bold">Glossaire</h1>
      <p class="mt-1 text-sm text-muted">Les termes de boxe et de renforcement, expliqués.</p>
    </header>

    <UInput
      v-model="query"
      icon="i-lucide-search"
      placeholder="Rechercher un terme…"
      size="lg"
      class="w-full"
      :ui="{ trailing: 'pe-1' }"
    >
      <template v-if="query" #trailing>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="link"
          size="sm"
          aria-label="Effacer"
          @click="query = ''"
        />
      </template>
    </UInput>

    <p v-if="!totalMatches" class="rounded-xl border border-default p-6 text-center text-muted">
      Aucun terme ne correspond à « {{ query }} ».
    </p>

    <section v-for="group in groups" :key="group.label" class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <UIcon :name="group.icon" class="size-4 text-primary" />
        {{ group.label }}
      </h2>
      <div class="space-y-3">
        <div
          v-for="{ key, entry } in group.entries"
          :key="key"
          class="rounded-xl border border-default p-4"
        >
          <h3 class="font-semibold">{{ entry.label }}</h3>
          <p class="mt-1 text-sm text-muted">{{ entry.definition }}</p>
          <div class="mt-3 rounded-lg bg-elevated/50 p-3">
            <p class="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
              <UIcon name="i-lucide-graduation-cap" class="size-3.5" /> Comment faire
            </p>
            <p class="text-sm text-muted">{{ entry.howTo }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
