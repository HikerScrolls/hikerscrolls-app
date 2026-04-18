-- HikerScrolls — tighten trip-photos bucket
-- Adds a 10 MiB per-file size cap and restricts MIME types to the
-- image formats the app actually uploads. Cross-user isolation is
-- already enforced by RLS + signed URLs — this is defence-in-depth
-- against a client bypass abusing a user's own quota / storing
-- non-image payloads.

update storage.buckets
set
  file_size_limit = 10485760, -- 10 MiB
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'trip-photos';
