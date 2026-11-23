-- Fix RAISE format error (bare % is invalid in RAISE)
create or replace function public.set_chama_late_fine_settings(
  p_chama_id uuid,
  p_late_fine_rate numeric,
  p_grace_days int default 0,
  p_auto_fines boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.chama_members
  where chama_id = p_chama_id and user_id = auth.uid() and status = 'active';
  if v_role is distinct from 'Chairperson' then
    raise exception 'Only the Chairperson can set late fine rules';
  end if;
  if p_late_fine_rate is null or p_late_fine_rate < 0 or p_late_fine_rate > 100 then
    raise exception 'Late fine rate must be between 0 and 100 percent';
  end if;

  update public.chamas
  set constitution = coalesce(constitution, '{}'::jsonb)
    || jsonb_build_object(
      'lateFineRate', p_late_fine_rate,
      'lateFineGraceDays', greatest(0, coalesce(p_grace_days, 0)),
      'autoFinesEnabled', coalesce(p_auto_fines, true)
    )
  where id = p_chama_id;

  return jsonb_build_object(
    'ok', true,
    'lateFineRate', p_late_fine_rate,
    'graceDays', greatest(0, coalesce(p_grace_days, 0)),
    'autoFinesEnabled', coalesce(p_auto_fines, true)
  );
end;
$$;

grant execute on function public.set_chama_late_fine_settings(uuid, numeric, int, boolean) to authenticated;
