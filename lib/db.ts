import { neon } from "@neondatabase/serverless";

/**
 * Lazily create the Neon client INSIDE request handlers (never at module
 * scope) so `next build` succeeds without DATABASE_URL set.
 */
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(url);
}
