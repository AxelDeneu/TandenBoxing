<script setup lang="ts">
import { tokenizeGlossary } from '~~/shared/glossary'

const props = defineProps<{ text: string }>()
const segments = computed(() => tokenizeGlossary(props.text))
const { open } = useGlossary()
</script>

<template>
  <span>
    <template v-for="(seg, i) in segments" :key="i">
      <button
        v-if="seg.entry"
        type="button"
        class="cursor-help font-medium text-primary underline decoration-dotted decoration-primary/50 underline-offset-2"
        @click="open(seg.entry)"
      >
        {{ seg.text
        }}<UIcon name="i-lucide-info" class="ml-0.5 inline size-3 align-super text-primary/80" />
      </button>
      <template v-else>{{ seg.text }}</template>
    </template>
  </span>
</template>
