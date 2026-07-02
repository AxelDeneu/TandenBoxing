import { eq } from 'drizzle-orm'

/** Accès aux dates « volontairement sans séance » (pas de régénération auto). */

export function isDateDismissed(date: string): boolean {
  return Boolean(
    useDatabase().select().from(dismissedDates).where(eq(dismissedDates.date, date)).get(),
  )
}

export function dismissDate(date: string): void {
  useDatabase().insert(dismissedDates).values({ date }).onConflictDoNothing().run()
}

export function undismissDate(date: string): void {
  useDatabase().delete(dismissedDates).where(eq(dismissedDates.date, date)).run()
}
