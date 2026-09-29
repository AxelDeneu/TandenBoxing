import type { OpenRouterModelDto } from '~~/shared/openrouter-models'

export interface ModelSelectItem {
  label: string
  value: string
  unavailable?: boolean
}

function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

export function buildModelSelectItems(
  models: readonly OpenRouterModelDto[],
  persistedModel: string,
  catalogState: 'available' | 'unavailable',
): ModelSelectItem[] {
  const items: ModelSelectItem[] = models.map((model) => ({
    label: `${model.name} — ${model.author} · ${compactTokens(model.contextLength)} contexte`,
    value: model.id,
  }))
  if (persistedModel && !models.some((model) => model.id === persistedModel)) {
    items.unshift({
      label: `${persistedModel} — ${
        catalogState === 'available' ? 'indisponible' : 'disponibilité non vérifiée'
      }`,
      value: persistedModel,
      unavailable: true,
    })
  }
  return items
}
