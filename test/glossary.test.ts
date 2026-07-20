import { describe, expect, it } from 'vitest'
import { GLOSSARY, GLOSSARY_GROUPS, tokenizeGlossary } from '../shared/glossary'

describe('tokenizeGlossary', () => {
  it('repère un terme et fournit son explication', () => {
    const seg = tokenizeGlossary('Envoie un jab rapide.').find((s) => s.entry)
    expect(seg?.text).toBe('jab')
    expect(seg?.entry?.label).toBe('Jab')
    expect(seg?.entry?.howTo.length).toBeGreaterThan(0)
  })

  it('reconstruit le texte complet à l’identique', () => {
    const text = 'Garde haute, jab puis cross.'
    expect(
      tokenizeGlossary(text)
        .map((s) => s.text)
        .join(''),
    ).toBe(text)
  })

  it('ne marque que la première occurrence d’un terme', () => {
    const segs = tokenizeGlossary('jab, encore un jab, toujours le jab')
    expect(segs.filter((s) => s.entry).length).toBe(1)
  })

  it('gère les alias et pluriels (crochets → crochet)', () => {
    const seg = tokenizeGlossary('Enchaîne des crochets.').find((s) => s.entry)
    expect(seg?.entry?.label).toBe('Crochet')
  })

  it('préfère le terme le plus long (shadow boxing)', () => {
    const seg = tokenizeGlossary('Un peu de shadow boxing pour finir.').find((s) => s.entry)
    expect(seg?.text.toLowerCase()).toBe('shadow boxing')
  })

  it('ne matche pas un terme à l’intérieur d’un autre mot', () => {
    expect(tokenizeGlossary('across the ring').some((s) => s.entry)).toBe(false)
  })

  it('gère la casse et les accents (Esquive)', () => {
    const seg = tokenizeGlossary('Fais une Esquive latérale.').find((s) => s.entry)
    expect(seg?.entry?.label).toBe('Esquive')
  })
})

describe('GLOSSARY_GROUPS', () => {
  it('couvre chaque terme du glossaire exactement une fois', () => {
    const grouped = GLOSSARY_GROUPS.flatMap((g) => g.keys)
    // Toutes les clés groupées existent dans GLOSSARY.
    for (const key of grouped) expect(GLOSSARY[key], `clé inconnue: ${key}`).toBeDefined()
    // Pas de doublon entre groupes.
    expect(new Set(grouped).size).toBe(grouped.length)
    // Chaque terme du glossaire est rangé quelque part.
    expect(new Set(grouped)).toEqual(new Set(Object.keys(GLOSSARY)))
  })
})
