-- Search indexes for provider discovery

CREATE INDEX IF NOT EXISTS idx_service_listings_tsv
    ON service_listings
    USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(description, '')));

CREATE INDEX IF NOT EXISTS idx_service_listings_status_updated
    ON service_listings (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_availability_listing_day
    ON service_availability (listing_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_service_areas_listing_region
    ON service_areas (listing_id, lower(region));
