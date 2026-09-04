-- Run once in Supabase SQL Editor if you already applied the original schema.
-- Allows hybrid chamas and multi-activity registration.

alter table public.chamas
  drop constraint if exists chamas_kind_check;

alter table public.chamas
  add constraint chamas_kind_check
  check (kind in (
    'merry-go-round',
    'table-banking',
    'welfare-pot',
    'investment-pool',
    'hybrid'
  ));
