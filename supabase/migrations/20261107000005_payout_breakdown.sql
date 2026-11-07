-- Payout breakdown: nobody works out an amount by hand.
-- Release and payout messages spell out item price, traveler commission and
-- app commission; admins get the exact amount and Whish number to send to;
-- the Whish transfer reference becomes optional.

-- ---------- 1. Helpers -------------------------------------------------------
-- $1,234.00 / 90,000 LBP
create or replace function public.money_text(p_amount numeric, p_currency public.escrow_currency)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_currency
    when 'USD' then '$' || to_char(p_amount, 'FM999,999,999,990.00')
    else to_char(p_amount, 'FM999,999,999,990') || ' LBP'
  end;
$$;

-- What the traveler is paid out of an escrow.
create or replace function public.traveler_payout_amount(e public.escrow_transactions)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select e.item_amount + e.reward_amount
         - case when e.fee_payer = 'traveler' then e.platform_fee else 0 end;
$$;

-- "item $229.00 + commission $20.00" (− app commission when the traveler pays it)
create or replace function public.traveler_split_text(e public.escrow_transactions)
returns text
language sql
immutable
set search_path = ''
as $$
  select format('item %s + commission %s%s',
    public.money_text(e.item_amount, e.currency),
    public.money_text(e.reward_amount, e.currency),
    case when e.fee_payer = 'traveler' and e.platform_fee > 0
         then ' − app commission ' || public.money_text(e.platform_fee, e.currency)
         else '' end);
$$;

revoke execute on function public.money_text(numeric, public.escrow_currency) from public, anon;
grant execute on function public.money_text(numeric, public.escrow_currency) to authenticated, service_role;
revoke execute on function public.traveler_payout_amount(public.escrow_transactions) from public, anon, authenticated;
revoke execute on function public.traveler_split_text(public.escrow_transactions) from public, anon, authenticated;

-- ---------- 2. Notifications carry the breakdown -----------------------------
create or replace function public.escrow_sync_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_traveler public.profiles;
  v_payout   text;
begin
  if new.order_id is null or new.status = old.status then
    return new;
  end if;
  select * into v_order from public.orders where id = new.order_id;
  v_payout := public.money_text(public.traveler_payout_amount(new), new.currency);

  if new.status = 'HELD' then
    update public.orders set status = 'PURCHASING'
      where id = new.order_id and status = 'AWAITING_PAYMENT_HOLD';
    perform public.notify(new.traveler_id, 'payment_held', 'Payment secured: you can buy the item',
      format('"%s": you get %s on delivery (%s).', v_order.title, v_payout, public.traveler_split_text(new)),
      '/orders/' || new.order_id);

  elsif new.status = 'RELEASED' then
    update public.orders set status = 'DELIVERED'
      where id = new.order_id and status in ('PURCHASING', 'IN_TRANSIT');
    perform public.notify(new.traveler_id, 'payment_released', 'Payment released',
      format('%s for "%s" is on its way to your Whish (%s).', v_payout, v_order.title, public.traveler_split_text(new)),
      '/payments');

    -- Admins: exactly what to send, and to whom.
    select * into v_traveler from public.profiles where id = new.traveler_id;
    perform public.notify(a.id, 'payout_queued',
      format('Send %s to %s on Whish', v_payout, coalesce(nullif(btrim(v_traveler.full_name), ''), 'the traveler')),
      format('"%s": item %s + traveler commission %s. App commission %s (%s). Whish number: %s.',
        v_order.title,
        public.money_text(new.item_amount, new.currency),
        public.money_text(new.reward_amount, new.currency),
        public.money_text(new.platform_fee, new.currency),
        case when new.fee_payer = 'traveler' then 'taken from the traveler' else 'paid by the shopper' end,
        coalesce(v_traveler.whish_phone, v_traveler.phone, 'none on file')),
      '/admin/escrow')
    from public.profiles a
    where a.role = 'admin';

  elsif new.status = 'REFUNDED' then
    update public.orders set status = 'CANCELLED', cancelled_at = now()
      where id = new.order_id and status not in ('DELIVERED', 'CANCELLED');
  end if;
  return new;
end;
$$;

revoke execute on function public.escrow_sync_order() from public, anon, authenticated;

-- ---------- 3. Mark a payout as sent: reference optional, traveler told ------
create or replace function public.mark_payout_paid(
  p_payout_id uuid,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.payouts;
  v_title  text;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;

  update public.payouts
  set status = 'paid', provider_reference = nullif(btrim(p_reference), ''), paid_by = auth.uid(), paid_at = now()
  where id = p_payout_id and status = 'queued'
  returning * into v_payout;

  if not found then
    raise exception 'payout not found or not queued' using errcode = 'P0002';
  end if;

  select o.title into v_title
  from public.escrow_transactions e join public.orders o on o.id = e.order_id
  where e.id = v_payout.escrow_id;

  perform public.notify(v_payout.traveler_id, 'payout_sent', 'Sent to your Whish',
    format('%s%s was sent to your Whish account%s.',
      public.money_text(v_payout.amount, v_payout.currency),
      case when v_title is not null then format(' for "%s"', v_title) else '' end,
      case when v_payout.provider_reference is not null then ' (ref ' || v_payout.provider_reference || ')' else '' end),
    '/payments');
end;
$$;

revoke execute on function public.mark_payout_paid(uuid, text) from public, anon;
grant execute on function public.mark_payout_paid(uuid, text) to authenticated;
