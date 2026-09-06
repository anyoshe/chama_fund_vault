-- Remove duplicate chamas created by the same account, keeping the oldest.
-- Run once in Supabase SQL Editor before adding the uniqueness constraint.

with ranked as (
  select
    id,
    first_value(id) over (
      partition by created_by, lower(trim(name))
      order by created_at, id
    ) as keep_id,
    row_number() over (
      partition by created_by, lower(trim(name))
      order by created_at, id
    ) as row_num
  from public.chamas
)
delete from public.chamas c
using ranked r
where c.id = r.id
  and r.row_num > 1;

create unique index if not exists idx_chamas_owner_name_unique
  on public.chamas (created_by, lower(trim(name)));
