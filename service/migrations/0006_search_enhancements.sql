-- Geolocation, favorites, and search history support

ALTER TABLE service_areas
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD CONSTRAINT service_areas_latitude_check CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
    ADD CONSTRAINT service_areas_longitude_check CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180));

CREATE INDEX IF NOT EXISTS idx_service_areas_coords
    ON service_areas (latitude, longitude);

CREATE TABLE IF NOT EXISTS provider_favorites (
    user_uuid UUID NOT NULL,
    listing_id UUID NOT NULL REFERENCES service_listings(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_uuid, listing_id)
);

CREATE TABLE IF NOT EXISTS provider_search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid UUID NOT NULL,
    query TEXT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_search_history_user_time
    ON provider_search_history (user_uuid, searched_at DESC);
