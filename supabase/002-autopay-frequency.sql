-- Nest update: autopays can repeat monthly, every 3 or 6 months, or yearly.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
alter table public.presets add column if not exists every text not null default 'month';
alter table public.presets drop constraint if exists presets_every_check;
alter table public.presets add constraint presets_every_check check (every in ('month','quarter','half','year'));
alter table public.presets add column if not exists due_month int;
alter table public.presets drop constraint if exists presets_due_month_check;
alter table public.presets add constraint presets_due_month_check check (due_month between 1 and 12);
notify pgrst, 'reload schema';
