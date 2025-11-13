package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

var (
	ErrMediaNotFound = errors.New("providers: media not found")
)

// MediaInput captures metadata for newly uploaded media assets.
type MediaInput struct {
	Title       string
	Description *string
	MediaType   string
	URL         string
	PreviewURL  *string
	FileName    string
	MimeType    string
	FileSize    int64
	IsPrimary   bool
	Metadata    map[string]any
}

// AddMedia stores a media asset for the given listing.
func (s *Store) AddMedia(ctx context.Context, listingID, userUUID string, input MediaInput) (MediaAsset, error) {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return MediaAsset{}, err
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	input.MediaType = strings.TrimSpace(strings.ToLower(input.MediaType))
	if input.MediaType != "image" && input.MediaType != "document" {
		return MediaAsset{}, fmt.Errorf("providers: unsupported media type %s", input.MediaType)
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return MediaAsset{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if input.MediaType == "image" {
		if input.IsPrimary {
			if _, err = tx.ExecContext(ctx, `UPDATE service_listing_media SET is_primary=FALSE WHERE listing_id=$1 AND media_type='image'`, listingID); err != nil {
				return MediaAsset{}, err
			}
		} else {
			var countImages int
			if err = tx.GetContext(ctx, &countImages, `SELECT COUNT(*) FROM service_listing_media WHERE listing_id=$1 AND media_type='image'`, listingID); err != nil {
				return MediaAsset{}, err
			}
			if countImages == 0 {
				input.IsPrimary = true
			}
		}
	} else {
		input.IsPrimary = false
	}

	var position int
	if err = tx.GetContext(ctx, &position, `SELECT COALESCE(MAX(position), -1) + 1 FROM service_listing_media WHERE listing_id=$1`, listingID); err != nil {
		return MediaAsset{}, err
	}

	now := time.Now().UTC()
	metaJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return MediaAsset{}, err
	}

	row := tx.QueryRowContext(ctx, `
		INSERT INTO service_listing_media (
			listing_id, media_type, title, description, url, preview_url, file_name, mime_type,
			file_size_bytes, is_primary, position, metadata, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
		RETURNING
			id, listing_id, media_type, title, description, url, preview_url, file_name, mime_type,
			file_size_bytes, is_primary, position, metadata, created_at, updated_at
	`, listingID, input.MediaType, input.Title, nullable(input.Description), input.URL, nullable(input.PreviewURL), input.FileName, input.MimeType, input.FileSize, input.IsPrimary, position, metaJSON, now)

	asset, err := scanMediaAsset(row)
	if err != nil {
		return MediaAsset{}, err
	}
	if err = tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	return asset, nil
}

// ListMedia returns all media assets for a listing belonging to a provider.
func (s *Store) ListMedia(ctx context.Context, listingID, userUUID string) ([]MediaAsset, error) {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return nil, err
	}
	return s.listingMedia(ctx, s.db, listingID)
}

// RemoveMedia deletes the requested media asset and returns the removed record.
func (s *Store) RemoveMedia(ctx context.Context, listingID, mediaID, userUUID string) (MediaAsset, error) {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return MediaAsset{}, err
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return MediaAsset{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	row := tx.QueryRowContext(ctx, `
		SELECT id, listing_id, media_type, title, description, url, preview_url, file_name, mime_type,
		       file_size_bytes, is_primary, position, metadata, created_at, updated_at
		FROM service_listing_media
		WHERE id=$1 AND listing_id=$2
		FOR UPDATE
	`, mediaID, listingID)
	asset, err := scanMediaAsset(row)
	if err != nil {
		if errors.Is(err, ErrMediaNotFound) || errors.Is(err, sql.ErrNoRows) {
			return MediaAsset{}, ErrMediaNotFound
		}
		return MediaAsset{}, err
	}

	if _, err = tx.ExecContext(ctx, `DELETE FROM service_listing_media WHERE id=$1 AND listing_id=$2`, mediaID, listingID); err != nil {
		return MediaAsset{}, err
	}

	if asset.MediaType == "image" && asset.IsPrimary {
		if _, err = tx.ExecContext(ctx, `
			WITH next_image AS (
				SELECT id FROM service_listing_media
				WHERE listing_id=$1 AND media_type='image'
				ORDER BY position ASC, created_at ASC
				LIMIT 1
			)
			UPDATE service_listing_media SET is_primary=TRUE
			WHERE id IN (SELECT id FROM next_image)
		`, listingID); err != nil {
			return MediaAsset{}, err
		}
	}

	if err = tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	return asset, nil
}

// SetPrimaryMedia marks the specified image as primary and returns the refreshed media list.
func (s *Store) SetPrimaryMedia(ctx context.Context, listingID, mediaID, userUUID string) ([]MediaAsset, error) {
	if err := s.ensureListingOwner(ctx, listingID, userUUID); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err = tx.ExecContext(ctx, `UPDATE service_listing_media SET is_primary=FALSE WHERE listing_id=$1 AND media_type='image'`, listingID); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE service_listing_media
		SET is_primary=TRUE, updated_at=$3
		WHERE id=$1 AND listing_id=$2 AND media_type='image'
	`, mediaID, listingID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return nil, ErrMediaNotFound
	}

	assets, err := s.listingMedia(ctx, tx, listingID)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return assets, nil
}

func (s *Store) listingMedia(ctx context.Context, q sqlx.QueryerContext, listingID string) ([]MediaAsset, error) {
	rows, err := q.QueryxContext(ctx, `
		SELECT id, listing_id, media_type, title, description, url, preview_url, file_name, mime_type,
		       file_size_bytes, is_primary, position, metadata, created_at, updated_at
		FROM service_listing_media
		WHERE listing_id=$1
		ORDER BY (CASE WHEN media_type='image' THEN 0 ELSE 1 END), is_primary DESC, position ASC, created_at ASC
	`, listingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assets []MediaAsset
	for rows.Next() {
		asset, err := scanMediaAsset(rows)
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

func (s *Store) attachMedia(ctx context.Context, listings []Listing) ([]Listing, error) {
	if len(listings) == 0 {
		return listings, nil
	}
	ids := make([]string, len(listings))
	for idx, listing := range listings {
		ids[idx] = listing.ID
	}
	query, args, err := sqlx.In(`
		SELECT id, listing_id, media_type, title, description, url, preview_url, file_name, mime_type,
		       file_size_bytes, is_primary, position, metadata, created_at, updated_at
		FROM service_listing_media
		WHERE listing_id IN (?)
		ORDER BY listing_id, (CASE WHEN media_type='image' THEN 0 ELSE 1 END), is_primary DESC, position ASC, created_at ASC
	`, ids)
	if err != nil {
		return nil, err
	}
	query = s.db.Rebind(query)

	rows, err := s.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	mediaMap := make(map[string][]MediaAsset, len(listings))
	for rows.Next() {
		asset, err := scanMediaAsset(rows)
		if err != nil {
			return nil, err
		}
		mediaMap[asset.ListingID] = append(mediaMap[asset.ListingID], asset)
	}

	for idx := range listings {
		if assets, ok := mediaMap[listings[idx].ID]; ok {
			listings[idx].Media = assets
		}
	}
	return s.applyMetrics(ctx, listings)
}

func scanMediaAsset(row interface {
	Scan(dest ...any) error
}) (MediaAsset, error) {
	var (
		id           string
		listingID    string
		mediaType    string
		title        string
		description  sql.NullString
		url          string
		previewURL   sql.NullString
		fileName     sql.NullString
		mimeType     sql.NullString
		fileSize     int64
		isPrimary    bool
		position     int
		metadataJSON []byte
		createdAt    time.Time
		updatedAt    time.Time
	)
	if err := row.Scan(&id, &listingID, &mediaType, &title, &description, &url, &previewURL, &fileName, &mimeType, &fileSize, &isPrimary, &position, &metadataJSON, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return MediaAsset{}, ErrMediaNotFound
		}
		return MediaAsset{}, err
	}
	metadata := map[string]any{}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &metadata); err != nil {
			return MediaAsset{}, err
		}
	}
	return MediaAsset{
		ID:            id,
		ListingID:     listingID,
		MediaType:     mediaType,
		Title:         title,
		Description:   nullableStringPtr(description),
		URL:           url,
		PreviewURL:    nullableStringPtr(previewURL),
		FileName:      nullableStringPtr(fileName),
		MimeType:      nullableStringPtr(mimeType),
		FileSizeBytes: fileSize,
		IsPrimary:     isPrimary,
		Position:      position,
		Metadata:      metadata,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}, nil
}
