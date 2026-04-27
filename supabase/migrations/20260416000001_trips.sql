-- HikerScrolls — cloud-synced trips
-- Creates per-user `trips` table with RLS + private photo storage bucket.

-- ── Table ───────────────────────────────────────────────────────

create table if not exists public.trips (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null default 'Untitled Trip',
  region          text,
  trip_date       date,
  end_date        date,
  description     text,
  template        text not null default 'scrollytelling',
  map_style       text not null default 'opentopomap',
  stats           jsonb not null default '{}'::jsonb,
  gpx_track       jsonb not null default '[]'::jsonb,
  waypoints       jsonb not null default '[]'::jsonb,
  cover_photo_id  text,
  version         int  not null default 5,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists trips_user_id_updated_at_idx
  on public.trips (user_id, updated_at desc);

-- ── updated_at trigger ─────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

-- ── Row-level security ──────────────────────────────────────────

alter table public.trips enable row level security;

drop policy if exists "trips_select_own" on public.trips;
create policy "trips_select_own"
  on public.trips for select
  using (auth.uid() = user_id);

drop policy if exists "trips_insert_own" on public.trips;
create policy "trips_insert_own"
  on public.trips for insert
  with check (auth.uid() = user_id);

drop policy if exists "trips_update_own" on public.trips;
create policy "trips_update_own"
  on public.trips for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trips_delete_own" on public.trips;
create policy "trips_delete_own"
  on public.trips for delete
  using (auth.uid() = user_id);

-- ── Storage bucket: trip-photos (private) ───────────────────────

insert into storage.buckets (id, name, public)
values ('trip-photos', 'trip-photos', false)
on conflict (id) do nothing;

-- Path convention: `{user_id}/{trip_id}/{photo_id}.jpg`
-- Owner check uses the first path segment.

drop policy if exists "trip_photos_select_own" on storage.objects;
create policy "trip_photos_select_own"
  on storage.objects for select
  using (
    bucket_id = 'trip-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "trip_photos_insert_own" on storage.objects;
create policy "trip_photos_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'trip-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "trip_photos_update_own" on storage.objects;
create policy "trip_photos_update_own"
  on storage.objects for update
  using (
    bucket_id = 'trip-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'trip-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "trip_photos_delete_own" on storage.objects;
create policy "trip_photos_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'trip-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
