-- Add Higgsfield's separate API as a third paid provider.
-- PostgreSQL enum additions are idempotent and keep existing rows unchanged.
alter type public.provider_id add value if not exists 'higgsfield';
