CREATE TABLE IF NOT EXISTS floorplans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_floorplans_owner ON floorplans(owner_user_id);

