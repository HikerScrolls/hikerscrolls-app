-- HikerScrolls — archive support for trips
-- Adds a nullable `archived_at` timestamp. Non-null => archived.

alter table public.trips
  add column if not exists archived_at timestamptz;

create index if not exists trips_user_id_archived_updated_idx
  on public.trips (user_id, archived_at nulls first, updated_at desc);
