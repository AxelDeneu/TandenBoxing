import { desc } from 'drizzle-orm'
import type { AiUsage, NewAiUsage } from '../database/schema'

/** Journal des appels au modèle (append-only). */

export function recordAiUsage(values: NewAiUsage): void {
  useDatabase().insert(aiUsage).values(values).run()
}

export function listAiUsage(limit = 500): AiUsage[] {
  return useDatabase().select().from(aiUsage).orderBy(desc(aiUsage.createdAt)).limit(limit).all()
}
