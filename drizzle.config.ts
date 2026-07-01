import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.NUXT_DATABASE_PATH || './data/tanden.db',
  },
  strict: true,
  verbose: true,
})
