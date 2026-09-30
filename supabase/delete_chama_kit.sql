-- Delete a mistaken chama kit/account (officials only).
-- Testing-friendly: balance is discarded. Standard kits can be force-deleted too.

create or replace function public.delete_chama_kit(
  p_chama_id uuid,
  p_kit_code text,
  p_force boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kit text := trim(p_kit_code);
  v_bal numeric := 0;
  v_label text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only Chairperson, Treasurer or Secretary can delete kits';
  end if;
  if nullif(v_kit, '') is null then raise exception 'Kit code required'; end if;

  select balance, label into v_bal, v_label
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = v_kit;

  if not found then
    raise exception 'Kit "%" not found on this chama', v_kit;
  end if;

  -- Optional guard: refuse deleting core kits unless force
  if not coalesce(p_force, true)
     and v_kit in (
       'table-banking', 'share-capital', 'general-savings', 'member-loans',
       'merry-go-round', 'welfare', 'group-reserve', 'registration-fees',
       'contingency'
     ) then
    raise exception 'Refusing to delete standard kit "%" without force', v_kit;
  end if;

  delete from public.member_kit_balances
  where chama_id = p_chama_id and kit_code = v_kit;

  delete from public.chama_kits
  where chama_id = p_chama_id and kit_code = v_kit;

  update public.chamas
  set pool_balance = coalesce((
    select sum(balance) from public.chama_kits where chama_id = p_chama_id
  ), 0)
  where id = p_chama_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, auth.uid(), 'withdrawal',
    format('Deleted kit "%s" (%s) — balance discarded', coalesce(v_label, v_kit), v_kit),
    coalesce(v_bal, 0)
  );

  return jsonb_build_object(
    'ok', true,
    'kitCode', v_kit,
    'label', v_label,
    'discardedBalance', coalesce(v_bal, 0)
  );
end;
$$;

grant execute on function public.delete_chama_kit(uuid, text, boolean) to authenticated;
