-- Viper Admin - Supabase schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to run multiple times.

create table if not exists public.viper_data (
  id integer primary key,
  doc jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seed a single document row if it doesn't exist yet.
insert into public.viper_data (id, doc)
values (
  1,
  '{
    "version": 1,
    "settings": {
      "maintenance": false,
      "maintenanceMessage": "Server is under maintenance. Please try again later.",
      "licenseSecret": "Vm8Lk7Uj2JmsjCPVPVjrLa7zgfx3uz9E",
      "downloadUrl": "",
      "versionUrl": "",
      "announcements": []
    },
    "keys": []
  }'::jsonb
)
on conflict (id) do nothing;

-- Grant access for the serverless API key only (service role key bypasses
-- RLS anyway, but keep the table accessible to authenticated service calls).
alter table public.viper_data enable row level security;

-- PostgREST needs the table exposed on the public schema; being in public
-- is enough. Optionally revoke anon access so only the server reads it:
revoke all on table public.viper_data from anon;
revoke all on table public.viper_data from authenticated;
grant all on table public.viper_data to service_role;
