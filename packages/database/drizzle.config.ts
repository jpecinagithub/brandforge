import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // generate does not need a live DB, but drizzle-kit requires the field.
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/brandforge',
  },
  verbose: true,
});
