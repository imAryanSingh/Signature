-- Run this entire file once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
-- If you're re-running this on a project that already has these tables, see the
-- "existing project" notes in README.md instead of running this whole file again.

-- PROFILES (extends built-in auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null,
  bio text default '',
  website text default '',
  instagram text default '',
  twitter text default '',
  avatar_url text,
  cover_url text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can insert their own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on profiles for update using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up via OTP (uses metadata passed at signup)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'name', 'New artist')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- WORKS (artwork posts)
create table works (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null default 'Untitled',
  description text default '',
  category text default 'Mixed',
  medium text default '',
  tags text[] default '{}',
  image_url text not null,
  views int default 0,
  critique_requested boolean default false,
  created_at timestamptz default now()
);

alter table works enable row level security;
create policy "Works are viewable by everyone" on works for select using (true);
create policy "Users can insert their own works" on works for insert with check (auth.uid() = user_id);
create policy "Users can update their own works" on works for update using (auth.uid() = user_id);
create policy "Users can delete their own works" on works for delete using (auth.uid() = user_id);

-- LIKES
create table likes (
  user_id uuid references profiles(id) on delete cascade,
  work_id uuid references works(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, work_id)
);

alter table likes enable row level security;
create policy "Likes are viewable by everyone" on likes for select using (true);
create policy "Users can like as themselves" on likes for insert with check (auth.uid() = user_id);
create policy "Users can unlike as themselves" on likes for delete using (auth.uid() = user_id);

-- COMMENTS
create table comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  work_id uuid references works(id) on delete cascade not null,
  text text not null,
  is_critique boolean default false,
  created_at timestamptz default now()
);

alter table comments enable row level security;
create policy "Comments are viewable by everyone" on comments for select using (true);
create policy "Users can comment as themselves" on comments for insert with check (auth.uid() = user_id);
create policy "Users can delete their own comments" on comments for delete using (auth.uid() = user_id);

-- FOLLOWS
create table follows (
  follower_id uuid references profiles(id) on delete cascade,
  following_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, following_id)
);

alter table follows enable row level security;
create policy "Follows are viewable by everyone" on follows for select using (true);
create policy "Users can follow as themselves" on follows for insert with check (auth.uid() = follower_id);
create policy "Users can unfollow as themselves" on follows for delete using (auth.uid() = follower_id);

-- COLLECTIONS
create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  work_ids uuid[] default '{}',
  created_at timestamptz default now()
);

alter table collections enable row level security;
create policy "Users can view their own collections" on collections for select using (auth.uid() = user_id);
create policy "Users can insert their own collections" on collections for insert with check (auth.uid() = user_id);
create policy "Users can update their own collections" on collections for update using (auth.uid() = user_id);
create policy "Users can delete their own collections" on collections for delete using (auth.uid() = user_id);

-- NOTIFICATIONS
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references profiles(id) on delete cascade not null,
  actor_id uuid references profiles(id) on delete cascade not null,
  type text not null, -- 'like' | 'comment' | 'follow'
  work_id uuid references works(id) on delete cascade,
  read boolean default false,
  created_at timestamptz default now()
);

alter table notifications enable row level security;
create policy "Users can view their own notifications" on notifications for select using (auth.uid() = recipient_id);
create policy "System can insert notifications" on notifications for insert with check (true);
create policy "Users can mark their own notifications read" on notifications for update using (auth.uid() = recipient_id);
create policy "Users can delete their own notifications" on notifications for delete using (auth.uid() = recipient_id);

-- Auto-notification triggers
create or replace function public.handle_new_like()
returns trigger as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, work_id)
  select w.user_id, new.user_id, 'like', new.work_id
  from public.works w where w.id = new.work_id and w.user_id != new.user_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_new_like on likes;
create trigger on_new_like after insert on likes for each row execute function public.handle_new_like();

create or replace function public.handle_new_comment()
returns trigger as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, work_id)
  select w.user_id, new.user_id, 'comment', new.work_id
  from public.works w where w.id = new.work_id and w.user_id != new.user_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_new_comment on comments;
create trigger on_new_comment after insert on comments for each row execute function public.handle_new_comment();

create or replace function public.handle_new_follow()
returns trigger as $$
begin
  insert into public.notifications (recipient_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_new_follow on follows;
create trigger on_new_follow after insert on follows for each row execute function public.handle_new_follow();

-- REPORTS (content moderation)
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete cascade not null,
  work_id uuid references works(id) on delete cascade not null,
  reason text not null,
  details text default '',
  status text not null default 'pending', -- 'pending' | 'reviewed' | 'dismissed'
  created_at timestamptz default now()
);

alter table reports enable row level security;
create policy "Users can view their own reports" on reports for select using (auth.uid() = reporter_id);
create policy "Users can submit reports" on reports for insert with check (auth.uid() = reporter_id);

-- STORAGE: bucket for artwork + avatars/covers (free tier: 1GB total)
insert into storage.buckets (id, name, public) values ('artwork', 'artwork', true);

create policy "Public read access to artwork bucket" on storage.objects
  for select using (bucket_id = 'artwork');

create policy "Authenticated users can upload to artwork bucket" on storage.objects
  for insert with check (bucket_id = 'artwork' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own uploads" on storage.objects
  for update using (bucket_id = 'artwork' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own uploads" on storage.objects
  for delete using (bucket_id = 'artwork' and auth.uid()::text = (storage.foldername(name))[1]);
