CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS profiles (
    user_uuid UUID PRIMARY KEY,
    profile_type TEXT NOT NULL,
    display_name TEXT NULL,
    headline TEXT NULL,
    company_name TEXT NULL,
    phone TEXT NULL,
    website TEXT NULL,
    location TEXT NULL,
    bio TEXT NULL,
    specialties TEXT[] NOT NULL DEFAULT '{}',
    avatar_url TEXT NULL,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    completion_score INTEGER NOT NULL DEFAULT 0,
    completion_sections JSONB NOT NULL DEFAULT '{}'::jsonb,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    verification_notes TEXT NULL,
    verified_by UUID NULL,
    verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_type ON profiles (profile_type);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles (verification_status);

CREATE TABLE IF NOT EXISTS profile_portfolio_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT NULL,
    media_url TEXT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_uuid) REFERENCES profiles(user_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_user ON profile_portfolio_items (user_uuid);
CREATE INDEX IF NOT EXISTS idx_portfolio_public ON profile_portfolio_items (user_uuid, is_public);
CREATE INDEX IF NOT EXISTS idx_portfolio_position ON profile_portfolio_items (user_uuid, position);

CREATE TABLE IF NOT EXISTS profile_certifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid UUID NOT NULL,
    name TEXT NOT NULL,
    issuer TEXT NULL,
    issued_on DATE NULL,
    expires_on DATE NULL,
    credential_id TEXT NULL,
    credential_url TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by UUID NULL,
    reviewed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_uuid) REFERENCES profiles(user_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_certifications_user ON profile_certifications (user_uuid);
CREATE INDEX IF NOT EXISTS idx_certifications_status ON profile_certifications (status);

CREATE TABLE IF NOT EXISTS profile_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid UUID NOT NULL,
    reviewer_uuid UUID NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title TEXT NULL,
    comment TEXT NULL,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_uuid) REFERENCES profiles(user_uuid) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_reviews_unique ON profile_reviews (user_uuid, reviewer_uuid);
CREATE INDEX IF NOT EXISTS idx_profile_reviews_user ON profile_reviews (user_uuid);
CREATE INDEX IF NOT EXISTS idx_profile_reviews_reviewer ON profile_reviews (reviewer_uuid);
