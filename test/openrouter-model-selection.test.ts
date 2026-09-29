import { describe, expect, it } from 'vitest'
import { buildModelSelectItems } from '../app/utils/model-catalog'
import type { OpenRouterModelDto } from '../shared/openrouter-models'

const model: OpenRouterModelDto = {
  id: 'google/gemini-compatible',
  name: 'Gemini compatible',
  author: 'google',
  contextLength: 128_000,
  pricing: { prompt: 0.000001, completion: 0.000002, cacheRead: null, cacheWrite: null },
  capabilities: {
    textInput: true,
    textOutput: true,
    structuredOutputs: true,
    maxOutputTokens: 16_384,
    zeroDataRetention: true,
  },
}

describe('sélecteur de modèles dynamique', () => {
  it('affiche le catalogue chargé sans identifiant statique ajouté', () => {
    expect(buildModelSelectItems([model], model.id, 'available')).toEqual([
      {
        label: 'Gemini compatible — google · 128k contexte',
        value: 'google/gemini-compatible',
      },
    ])
  })

  it('gère un catalogue vide sans effacer le modèle persisté', () => {
    expect(buildModelSelectItems([], 'mistralai/mistral-large', 'available')).toEqual([
      {
        label: 'mistralai/mistral-large — indisponible',
        value: 'mistralai/mistral-large',
        unavailable: true,
      },
    ])
  })

  it('garde un état non vérifié pendant le chargement ou une panne', () => {
    expect(buildModelSelectItems([], 'openai/gpt-compatible', 'unavailable')[0]).toEqual({
      label: 'openai/gpt-compatible — disponibilité non vérifiée',
      value: 'openai/gpt-compatible',
      unavailable: true,
    })
  })

  it('conserve en tête un modèle disparu tout en proposant les remplaçants', () => {
    const items = buildModelSelectItems([model], 'openai/retired-model', 'available')
    expect(items.map((item) => item.value)).toEqual([
      'openai/retired-model',
      'google/gemini-compatible',
    ])
    expect(items[0]?.label).toContain('indisponible')
  })
})
