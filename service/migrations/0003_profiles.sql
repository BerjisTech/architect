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

CREATE TABLE IF NOT EXISTS provider_onboarding (
    user_uuid UUID PRIMARY KEY,
    profile_type TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'submitted',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by UUID NULL,
    reviewed_at TIMESTAMPTZ NULL,
    notes TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_uuid) REFERENCES profiles(user_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_onboarding_stage ON provider_onboarding (stage);

CREATE TABLE IF NOT EXISTS service_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid UUID NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NULL,
    description TEXT NULL,
    category TEXT NOT NULL,
    pricing_model TEXT NOT NULL DEFAULT 'fixed',
    base_price_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_uuid) REFERENCES profiles(user_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_listings_user ON service_listings (user_uuid);
CREATE INDEX IF NOT EXISTS idx_service_listings_status ON service_listings (status);

CREATE TABLE IF NOT EXISTS service_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id UUID NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_minutes INTEGER NOT NULL,
    end_minutes INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (listing_id) REFERENCES service_listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_availability_listing ON service_availability (listing_id);
CREATE INDEX IF NOT EXISTS idx_service_availability_day ON service_availability (listing_id, day_of_week);

CREATE TABLE IF NOT EXISTS service_areas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id UUID NOT NULL,
    region TEXT NOT NULL,
    country_code TEXT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (listing_id) REFERENCES service_listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_areas_listing ON service_areas (listing_id);

CREATE TABLE IF NOT EXISTS provider_response_stats (
    user_uuid UUID PRIMARY KEY,
    total_responses INTEGER NOT NULL DEFAULT 0,
    average_minutes NUMERIC(10,2) NOT NULL DEFAULT 0,
    jobs_completed INTEGER NOT NULL DEFAULT 0,
    last_response_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_uuid) REFERENCES profiles(user_uuid) ON DELETE CASCADE
);
