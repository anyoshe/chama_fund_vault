-- In-app health: which critical functions/tables exist
create or replace function public.chamavault_health_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fns text[] := array[
    'submit_pending_contribution',
    'approve_pending_contribution',
    'reject_pending_contribution',
    'list_pending_contributions',
    'pay_contribution_obligation',
    'list_my_obligations',
    'list_my_payment_dues',
    'generate_plan_obligations',
    'backfill_obligations_from_join',
    'assess_late_fines_for_chama',
    'upsert_contribution_plan',
    'disburse_from_loan_fund',
    'repay_loan',
    'get_member_loan_limit',
    'create_chama_with_founder',
    'list_chama_members',
    'list_chama_kits',
    'list_member_kit_balances',
    'upsert_chama_mpesa_credentials',
    'get_chama_mpesa_status',
    'get_chama_mpesa_credentials_internal',
    'set_chama_payment_mode',
    'record_group_expense',
    'reallocate_contribution',
    'notify_loan_proposed'
  ];
  v_tables text[] := array[
    'chamas',
    'chama_members',
    'profiles',
    'contributions',
    'chama_kits',
    'member_kit_balances',
    'contribution_plans',
    'contribution_obligations',
    'member_penalties',
    'chama_mpesa_credentials',
    'mpesa_stk_requests',
    'audit_events',
    'proposals'
  ];
  v_fn text;
  v_tb text;
  v_ok jsonb := '[]'::jsonb;
  v_missing_fn jsonb := '[]'::jsonb;
  v_missing_tb jsonb := '[]'::jsonb;
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  foreach v_fn in array v_fns loop
    select exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
    ) into v_exists;
    if v_exists then
      v_ok := v_ok || jsonb_build_array(v_fn);
    else
      v_missing_fn := v_missing_fn || jsonb_build_array(v_fn);
    end if;
  end loop;

  foreach v_tb in array v_tables loop
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = v_tb
    ) into v_exists;
    if not v_exists then
      v_missing_tb := v_missing_tb || jsonb_build_array(v_tb);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_missing_fn) = 0 and jsonb_array_length(v_missing_tb) = 0,
    'functionsPresent', v_ok,
    'functionsMissing', v_missing_fn,
    'tablesMissing', v_missing_tb,
    'checkedAt', now(),
    'hint', case
      when jsonb_array_length(v_missing_fn) = 0 and jsonb_array_length(v_missing_tb) = 0
        then 'All critical SQL pieces found'
      else 'Run the matching files in supabase/ folder via SQL Editor, then re-check'
    end
  );
end;
$$;

grant execute on function public.chamavault_health_check() to authenticated;
