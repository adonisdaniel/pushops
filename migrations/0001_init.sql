-- PushOps initial schema.
-- Dialect: SQLite / libSQL (Turso Cloud). Timestamps are epoch milliseconds (INTEGER).

CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id                INTEGER NOT NULL UNIQUE,
    nickname             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    nickname_custom      INTEGER NOT NULL DEFAULT 0,
    tg_username          TEXT    NOT NULL DEFAULT '',
    first_name           TEXT    NOT NULL DEFAULT '',
    photo_url            TEXT    NOT NULL DEFAULT '',
    weight_kg            REAL    NOT NULL DEFAULT 70,
    weight_since         INTEGER NOT NULL DEFAULT 0,
    weights_confirmed_at INTEGER NOT NULL DEFAULT 0,
    trust_level          INTEGER NOT NULL DEFAULT 0,
    tz_offset            INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_nickname ON users (nickname COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_users_tg_username ON users (tg_username);

-- Append-only weight history so that scoring a workout always uses the weight
-- that was declared at the time, and gaining weight never rewrites history.
CREATE TABLE IF NOT EXISTS user_weights (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    weight_kg      REAL    NOT NULL,
    effective_from INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_weights_unique ON user_weights (user_id, effective_from);

CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token_hash TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS workouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    client_id   TEXT    NOT NULL DEFAULT '',
    variant     TEXT    NOT NULL DEFAULT 'standard',
    mode        TEXT    NOT NULL DEFAULT 'suelo',
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER NOT NULL,
    local_date  TEXT    NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    reps_total  INTEGER NOT NULL DEFAULT 0,
    reps_valid  INTEGER NOT NULL DEFAULT 0,
    avg_rep_ms  INTEGER NOT NULL DEFAULT 0,
    best_rep_ms INTEGER NOT NULL DEFAULT 0,
    points      REAL    NOT NULL DEFAULT 0,
    meta        TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_started ON workouts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date    ON workouts (user_id, local_date);
CREATE INDEX IF NOT EXISTS idx_workouts_points       ON workouts (points DESC);

-- The client generates a stable id per set, so retrying an upload after a
-- dropped connection never counts the same set twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_client ON workouts (user_id, client_id) WHERE client_id != '';

CREATE TABLE IF NOT EXISTS reps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id  INTEGER NOT NULL,
    idx         INTEGER NOT NULL,
    t_ms        INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    fill_max    REAL    NOT NULL DEFAULT 0,
    elbow_min   REAL    NOT NULL DEFAULT 0,
    ok          INTEGER NOT NULL DEFAULT 0,
    conf        REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reps_workout ON reps (workout_id);

-- One row per pair of users, whatever the request direction.
CREATE TABLE IF NOT EXISTS friendships (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    created_at   INTEGER NOT NULL,
    responded_at INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair
    ON friendships (MIN(requester_id, addressee_id), MAX(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id, status);

CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    owner_id    INTEGER NOT NULL,
    invite_code TEXT    NOT NULL UNIQUE,
    is_private  INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    role      TEXT    NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
