-- Normalize listing statuses and enforce allowed values

ALTER TABLE service_listings
    ALTER COLUMN status SET DEFAULT 'pending';

UPDATE service_listings SET status = 'pending' WHERE status = 'draft';
UPDATE service_listings SET status = 'inactive' WHERE status IN ('archived', 'inactive');

ALTER TABLE service_listings
    DROP CONSTRAINT IF EXISTS chk_service_listings_status;

ALTER TABLE service_listings
    ADD CONSTRAINT chk_service_listings_status CHECK (status IN ('pending', 'active', 'inactive'));
