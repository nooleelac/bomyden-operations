-- Chuyển extension btree_gist khỏi schema public (theo Supabase security advisor)
create schema if not exists extensions;
alter extension btree_gist set schema extensions;
