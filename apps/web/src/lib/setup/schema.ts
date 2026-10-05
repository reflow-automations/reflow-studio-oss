/**
 * Database schema version this build of the app expects.
 *
 * Every migration in supabase/migrations redefines `public.studio_schema_version()`
 * to return its own number; bump this constant in the same change. A test
 * (apps/web/test/setup.schema.test.ts) fails when the two drift apart.
 */
export const REQUIRED_SCHEMA_VERSION = 8;
