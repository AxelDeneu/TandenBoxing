<script setup lang="ts">
import { tokenizeGlossary } from '~~/shared/glossary'

const props = defineProps<{ text: string }>()
const segments = computed(() => tokenizeGlossary(props.text))
</script>

<template>
  <span>
    <template v-for="(seg, i) in segments" :key="i">
      <UPopover v-if="seg.entry" :ui="{ content: 'max-w-xs' }">
        <button
          type="button"
          class="cursor-help font-medium text-primary underline decoration-dotted decoration-primary/50 underline-offset-2"
        >
          {{ seg.text
          }}<UIcon name="i-lucide-info" class="ml-0.5 inline size-3 align-super text-primary/80" />
        </button>

        <template #content>
          <div class="max-w-xs space-y-2 p-3 text-sm">
            <p class="font-semibold text-primary">{{ seg.entry.label }}</p>
            <p class="text-muted">{{ seg.entry.definition }}</p>
            <div>
              <p class="mb-0.5 flex items-center gap-1 font-medium">
                <UIcon name="i-lucide-target" class="size-3.5 text-primary" /> Comment faire
              </p>
              <p class="text-muted">{{ seg.entry.howTo }}</p>
            </div>
          </div>
        </template>
      </UPopover>
      <template v-else>{{ seg.text }}</template>
    </template>
  </span>
</template>
