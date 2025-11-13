-- Service listing rich content and analytics support

CREATE TABLE IF NOT EXISTS service_listing_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id UUID NOT NULL REFERENCES service_listings(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'document')),
    title TEXT NOT NULL,
    description TEXT NULL,
    url TEXT NOT NULL,
    preview_url TEXT NULL,
    file_name TEXT NULL,
    mime_type TEXT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_listing_media_listing ON service_listing_media (listing_id);
CREATE INDEX IF NOT EXISTS idx_service_listing_media_primary ON service_listing_media (listing_id, is_primary) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_service_listing_media_position ON service_listing_media (listing_id, position);

ALTER TABLE service_listings
    ADD COLUMN IF NOT EXISTS preview_token UUID NOT NULL DEFAULT uuid_generate_v4(),
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_listings_preview_token
    ON service_listings (preview_token);

CREATE TABLE IF NOT EXISTS service_listing_metrics (
    listing_id UUID PRIMARY KEY REFERENCES service_listings(id) ON DELETE CASCADE,
    view_count BIGINT NOT NULL DEFAULT 0,
    contact_count BIGINT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ NULL,
    last_contact_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
