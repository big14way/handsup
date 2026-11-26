create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_token text unique,
  chat_id bigint,
  chat_title text not null default 'Q&A',
  host_tg_id bigint,
  host_name text,
  wallet text,
  status text not null default 'live',
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  tg_user_id bigint not null,
  tg_name text not null,
  text text not null,
  short text not null,
  votes int not null default 1,
  boost numeric not null default 0,
  status text not null default 'open',
  transcript text not null default '',
  summary text,
  tg_message_id bigint,
  created_at timestamptz not null default now(),
  live_at timestamptz,
  answered_at timestamptz
);

create index if not exists questions_session_status on questions (session_id, status);

create table if not exists votes (
  question_id bigint not null references questions(id) on delete cascade,
  tg_user_id bigint not null,
  primary key (question_id, tg_user_id)
);

-- One row per on-chain tip. The transaction hash makes crediting idempotent.
create table if not exists boosts (
  tx_hash text primary key,
  question_id bigint not null references questions(id) on delete cascade,
  amount numeric not null,
  from_address text not null,
  created_at timestamptz not null default now()
);
