import type { GlossaryEntry } from '~~/shared/glossary'

// State partagé (singleton) : un seul drawer pour toute l'appli.
const isOpen = ref(false)
const current = ref<GlossaryEntry | null>(null)

export function useGlossary() {
  function open(entry: GlossaryEntry) {
    current.value = entry
    isOpen.value = true
  }
  function close() {
    isOpen.value = false
  }
  return { isOpen, current, open, close }
}
