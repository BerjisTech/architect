package categories

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
	// ErrCategoryNotFound is returned when a category key does not exist.
	ErrCategoryNotFound = errors.New("categories: category not found")
	// ErrSubcategoryNotFound is returned when a subcategory key does not match the parent category.
	ErrSubcategoryNotFound = errors.New("categories: subcategory not found")
)

// Store provides access to service category metadata.
type Store struct {
	db *sqlx.DB
}

// NewStore constructs a category store.
func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

// Category represents the full category definition including subcategories and attributes.
type Category struct {
	ID            string         `json:"-"`
	Key           string         `json:"key"`
	Name          string         `json:"name"`
	Description   *string        `json:"description,omitempty"`
	Icon          *string        `json:"icon,omitempty"`
	CreatedAt     time.Time      `json:"-"`
	UpdatedAt     time.Time      `json:"-"`
	Subcategories []Subcategory  `json:"subcategories"`
	Attributes    []AttributeDef `json:"attributes"`
}

// Subcategory groups a specific service offering.
type Subcategory struct {
	Key         string         `json:"key"`
	Name        string         `json:"name"`
	Description *string        `json:"description,omitempty"`
	Filters     map[string]any `json:"filters,omitempty"`
	Position    int            `json:"position"`
	CreatedAt   time.Time      `json:"-"`
	UpdatedAt   time.Time      `json:"-"`
}

// AttributeDef describes a filterable attribute assigned to a category.
type AttributeDef struct {
	Key          string         `json:"key"`
	Label        string         `json:"label"`
	DataType     string         `json:"dataType"`
	FilterConfig map[string]any `json:"filterConfig"`
	Required     bool           `json:"required"`
	CreatedAt    time.Time      `json:"-"`
	UpdatedAt    time.Time      `json:"-"`
}

// UpsertCategory creates or updates a category.
func (s *Store) UpsertCategory(ctx context.Context, key, name string, description, icon *string) (Category, error) {
	key = normalizeKey(key)
	now := time.Now().UTC()
	var record Category
	err := s.db.QueryRowxContext(ctx, `
		INSERT INTO service_categories (key, name, description, icon, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $5)
		ON CONFLICT (key) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			icon = EXCLUDED.icon,
			updated_at = $5
		RETURNING id, key, name, description, icon, created_at, updated_at
	`, key, strings.TrimSpace(name), nullable(description), nullable(icon), now).Scan(
		&record.ID, &record.Key, &record.Name, &record.Description, &record.Icon, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return Category{}, err
	}
	return record, nil
}

// UpsertSubcategory creates or updates a subcategory under the provided category key.
func (s *Store) UpsertSubcategory(ctx context.Context, categoryKey, key, name string, description *string, filters map[string]any, position int) (Subcategory, error) {
	categoryKey = normalizeKey(categoryKey)
	categoryID, err := s.categoryID(ctx, categoryKey)
	if err != nil {
		return Subcategory{}, err
	}

	filtersJSON, err := json.Marshal(filters)
	if err != nil {
		return Subcategory{}, fmt.Errorf("categories: marshal filters: %w", err)
	}

	now := time.Now().UTC()
	var record Subcategory
	err = s.db.QueryRowxContext(ctx, `
		INSERT INTO service_subcategories (category_id, key, name, description, filters, position, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
		ON CONFLICT (category_id, key) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			filters = EXCLUDED.filters,
			position = EXCLUDED.position,
			updated_at = $7
		RETURNING key, name, description, filters, position, created_at, updated_at
	`, categoryID, normalizeKey(key), strings.TrimSpace(name), nullable(description), filtersJSON, position, now).Scan(
		&record.Key, &record.Name, &record.Description, &filtersJSON, &record.Position, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return Subcategory{}, err
	}
	record.Filters = decodeJSONMap(filtersJSON)
	return record, nil
}

// UpsertAttribute creates or updates an attribute definition for a category.
func (s *Store) UpsertAttribute(ctx context.Context, categoryKey, key, label, dataType string, required bool, filterConfig map[string]any) (AttributeDef, error) {
	categoryKey = normalizeKey(categoryKey)
	categoryID, err := s.categoryID(ctx, categoryKey)
	if err != nil {
		return AttributeDef{}, err
	}
	dataType = strings.ToLower(strings.TrimSpace(dataType))
	if dataType == "" {
		return AttributeDef{}, errors.New("categories: data type is required")
	}
	cfgJSON, err := json.Marshal(filterConfig)
	if err != nil {
		return AttributeDef{}, fmt.Errorf("categories: marshal filter config: %w", err)
	}
	now := time.Now().UTC()
	var record AttributeDef
	err = s.db.QueryRowxContext(ctx, `
		INSERT INTO service_category_attributes (category_id, key, label, data_type, filter_config, required, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
		ON CONFLICT (category_id, key) DO UPDATE SET
			label = EXCLUDED.label,
			data_type = EXCLUDED.data_type,
			filter_config = EXCLUDED.filter_config,
			required = EXCLUDED.required,
			updated_at = $7
		RETURNING key, label, data_type, filter_config, required, created_at, updated_at
	`, categoryID, normalizeKey(key), strings.TrimSpace(label), dataType, cfgJSON, required, now).Scan(
		&record.Key, &record.Label, &record.DataType, &cfgJSON, &record.Required, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		return AttributeDef{}, err
	}
	record.FilterConfig = decodeJSONMap(cfgJSON)
	return record, nil
}

// List returns all categories with their subcategories and attributes.
func (s *Store) List(ctx context.Context) ([]Category, error) {
	rows, err := s.db.QueryxContext(ctx, `
		SELECT id, key, name, description, icon, created_at, updated_at
		FROM service_categories
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	idToCategory := make(map[string]*Category)
	var categories []Category
	for rows.Next() {
		var cat Category
		if err := rows.Scan(&cat.ID, &cat.Key, &cat.Name, &cat.Description, &cat.Icon, &cat.CreatedAt, &cat.UpdatedAt); err != nil {
			return nil, err
		}
		cat.Subcategories = []Subcategory{}
		cat.Attributes = []AttributeDef{}
		idToCategory[cat.ID] = &cat
		categories = append(categories, cat)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(categories) == 0 {
		return categories, nil
	}

	ids := make([]any, 0, len(categories))
	for _, cat := range categories {
		ids = append(ids, cat.ID)
	}

	query, args, err := sqlx.In(`
		SELECT category_id, key, name, description, filters, position, created_at, updated_at
		FROM service_subcategories
		WHERE category_id IN (?)
		ORDER BY position ASC, name ASC
	`, ids)
	if err != nil {
		return nil, err
	}
	query = s.db.Rebind(query)
	subRows, err := s.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	for subRows.Next() {
		var (
			categoryID  string
			rec         Subcategory
			filtersJSON []byte
		)
		if err := subRows.Scan(&categoryID, &rec.Key, &rec.Name, &rec.Description, &filtersJSON, &rec.Position, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			subRows.Close()
			return nil, err
		}
		rec.Filters = decodeJSONMap(filtersJSON)
		if cat := idToCategory[categoryID]; cat != nil {
			cat.Subcategories = append(cat.Subcategories, rec)
		}
	}
	subRows.Close()

	attrQuery, attrArgs, err := sqlx.In(`
		SELECT category_id, key, label, data_type, filter_config, required, created_at, updated_at
		FROM service_category_attributes
		WHERE category_id IN (?)
		ORDER BY label ASC
	`, ids)
	if err != nil {
		return nil, err
	}
	attrQuery = s.db.Rebind(attrQuery)
	attrRows, err := s.db.QueryxContext(ctx, attrQuery, attrArgs...)
	if err != nil {
		return nil, err
	}
	for attrRows.Next() {
		var (
			categoryID string
			att        AttributeDef
			cfgJSON    []byte
		)
		if err := attrRows.Scan(&categoryID, &att.Key, &att.Label, &att.DataType, &cfgJSON, &att.Required, &att.CreatedAt, &att.UpdatedAt); err != nil {
			attrRows.Close()
			return nil, err
		}
		att.DataType = strings.ToLower(att.DataType)
		att.FilterConfig = decodeJSONMap(cfgJSON)
		if cat := idToCategory[categoryID]; cat != nil {
			cat.Attributes = append(cat.Attributes, att)
		}
	}
	attrRows.Close()

	// Return values (map stored pointer references, need to dereference).
	result := make([]Category, len(categories))
	for i, cat := range categories {
		result[i] = *idToCategory[cat.ID]
	}
	return result, nil
}

// Definition returns a single category definition by key.
func (s *Store) Definition(ctx context.Context, categoryKey string) (Category, error) {
	categoryKey = normalizeKey(categoryKey)
	var cat Category
	err := s.db.QueryRowxContext(ctx, `
		SELECT id, key, name, description, icon, created_at, updated_at
		FROM service_categories
		WHERE key = $1
	`, categoryKey).Scan(&cat.ID, &cat.Key, &cat.Name, &cat.Description, &cat.Icon, &cat.CreatedAt, &cat.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Category{}, ErrCategoryNotFound
		}
		return Category{}, err
	}

	subRows, err := s.db.QueryxContext(ctx, `
		SELECT key, name, description, filters, position, created_at, updated_at
		FROM service_subcategories
		WHERE category_id = $1
		ORDER BY position ASC, name ASC
	`, cat.ID)
	if err != nil {
		return Category{}, err
	}
	cat.Subcategories = []Subcategory{}
	for subRows.Next() {
		var sc Subcategory
		var filtersJSON []byte
		if err := subRows.Scan(&sc.Key, &sc.Name, &sc.Description, &filtersJSON, &sc.Position, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
			subRows.Close()
			return Category{}, err
		}
		sc.Filters = decodeJSONMap(filtersJSON)
		cat.Subcategories = append(cat.Subcategories, sc)
	}
	subRows.Close()

	attrRows, err := s.db.QueryxContext(ctx, `
		SELECT key, label, data_type, filter_config, required, created_at, updated_at
		FROM service_category_attributes
		WHERE category_id = $1
		ORDER BY label ASC
	`, cat.ID)
	if err != nil {
		return Category{}, err
	}
	cat.Attributes = []AttributeDef{}
	for attrRows.Next() {
		var att AttributeDef
		var cfgJSON []byte
		if err := attrRows.Scan(&att.Key, &att.Label, &att.DataType, &cfgJSON, &att.Required, &att.CreatedAt, &att.UpdatedAt); err != nil {
			attrRows.Close()
			return Category{}, err
		}
		att.DataType = strings.ToLower(att.DataType)
		att.FilterConfig = decodeJSONMap(cfgJSON)
		cat.Attributes = append(cat.Attributes, att)
	}
	attrRows.Close()

	return cat, nil
}

// ValidateListingMetadata validates the category, subcategory, and attributes for a listing.
func (s *Store) ValidateListingMetadata(ctx context.Context, categoryKey, subcategoryKey string, attributes map[string]any) (Category, Subcategory, map[string]any, error) {
	category, err := s.Definition(ctx, categoryKey)
	if err != nil {
		return Category{}, Subcategory{}, nil, err
	}

	var sub Subcategory
	if strings.TrimSpace(subcategoryKey) != "" {
		found := false
		subKey := normalizeKey(subcategoryKey)
		for _, candidate := range category.Subcategories {
			if candidate.Key == subKey {
				sub = candidate
				found = true
				break
			}
		}
		if !found {
			return Category{}, Subcategory{}, nil, ErrSubcategoryNotFound
		}
	}

	sanitisedAttrs, err := SanitiseAttributes(category.Attributes, attributes)
	if err != nil {
		return Category{}, Subcategory{}, nil, err
	}
	return category, sub, sanitisedAttrs, nil
}

// SanitiseAttributes normalises attribute payloads according to definitions.
func SanitiseAttributes(defs []AttributeDef, attrs map[string]any) (map[string]any, error) {
	if attrs == nil {
		attrs = map[string]any{}
	}
	result := make(map[string]any, len(attrs))
	defIndex := make(map[string]AttributeDef, len(defs))
	for _, def := range defs {
		defIndex[def.Key] = def
	}

	for key, value := range attrs {
		normKey := normalizeKey(key)
		def, ok := defIndex[normKey]
		if !ok {
			return nil, fmt.Errorf("categories: attribute %s is not allowed for this category", normKey)
		}
		normalised, err := normaliseAttributeValue(def, value)
		if err != nil {
			return nil, err
		}
		result[normKey] = normalised
	}

	for _, def := range defs {
		if def.Required {
			if _, ok := result[def.Key]; !ok {
				return nil, fmt.Errorf("categories: attribute %s is required", def.Key)
			}
		}
	}
	return result, nil
}

// normaliseAttributeValue coerces types to deterministic forms and validates allowed options.
func normaliseAttributeValue(def AttributeDef, value any) (any, error) {
	switch def.DataType {
	case "boolean":
		switch v := value.(type) {
		case bool:
			return v, nil
		case string:
			lower := strings.ToLower(strings.TrimSpace(v))
			if lower == "true" || lower == "1" || lower == "yes" {
				return true, nil
			}
			if lower == "false" || lower == "0" || lower == "no" {
				return false, nil
			}
		case float64:
			return v != 0, nil
		case int, int64:
			return fmt.Sprintf("%v", v) != "0", nil
		}
		return nil, fmt.Errorf("categories: attribute %s expects boolean", def.Key)
	case "number":
		switch v := value.(type) {
		case float64:
			return v, nil
		case int:
			return float64(v), nil
		case int64:
			return float64(v), nil
		case json.Number:
			f, err := v.Float64()
			if err != nil {
				return nil, fmt.Errorf("categories: attribute %s invalid number", def.Key)
			}
			return f, nil
		case string:
			if strings.TrimSpace(v) == "" {
				return nil, fmt.Errorf("categories: attribute %s expects number", def.Key)
			}
			num, err := json.Number(strings.TrimSpace(v)).Float64()
			if err != nil {
				return nil, fmt.Errorf("categories: attribute %s invalid number", def.Key)
			}
			return num, nil
		}
		return nil, fmt.Errorf("categories: attribute %s expects number", def.Key)
	case "enum":
		str, ok := toString(value)
		if !ok {
			return nil, fmt.Errorf("categories: attribute %s expects string option", def.Key)
		}
		if !containsOption(def.FilterConfig, str) {
			return nil, fmt.Errorf("categories: attribute %s option not allowed", def.Key)
		}
		return str, nil
	case "multiselect":
		switch v := value.(type) {
		case []any:
			return validateStringSlice(def, v)
		case []string:
			values := make([]string, len(v))
			copy(values, v)
			return validateStringSlice(def, anySlice(values))
		case string:
			if strings.TrimSpace(v) == "" {
				return []string{}, nil
			}
			return validateStringSlice(def, anySlice(strings.Split(v, ",")))
		default:
			return nil, fmt.Errorf("categories: attribute %s expects list", def.Key)
		}
	default:
		// default to string
		str, ok := toString(value)
		if !ok {
			return nil, fmt.Errorf("categories: attribute %s expects string", def.Key)
		}
		return str, nil
	}
}

func validateStringSlice(def AttributeDef, values []any) ([]string, error) {
	result := make([]string, 0, len(values))
	for _, raw := range values {
		str, ok := toString(raw)
		if !ok {
			return nil, fmt.Errorf("categories: attribute %s expects string list", def.Key)
		}
		str = strings.TrimSpace(str)
		if str == "" {
			continue
		}
		if !containsOption(def.FilterConfig, str) {
			return nil, fmt.Errorf("categories: attribute %s option %s not allowed", def.Key, str)
		}
		if !contains(result, str) {
			result = append(result, str)
		}
	}
	return result, nil
}

func containsOption(cfg map[string]any, value string) bool {
	rawOptions, ok := cfg["options"]
	if !ok {
		return true
	}
	switch opts := rawOptions.(type) {
	case []any:
		for _, opt := range opts {
			if str, ok := toString(opt); ok && strings.EqualFold(str, value) {
				return true
			}
		}
	case []string:
		for _, opt := range opts {
			if strings.EqualFold(opt, value) {
				return true
			}
		}
	}
	return false
}

func contains(haystack []string, needle string) bool {
	for _, v := range haystack {
		if v == needle {
			return true
		}
	}
	return false
}

func (s *Store) categoryID(ctx context.Context, key string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM service_categories WHERE key=$1`, key).Scan(&id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrCategoryNotFound
		}
		return "", err
	}
	return id, nil
}

func decodeJSONMap(data []byte) map[string]any {
	if len(data) == 0 {
		return nil
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func nullable(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func normalizeKey(key string) string {
	return strings.TrimSpace(strings.ToLower(key))
}

func toString(value any) (string, bool) {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v), true
	case fmt.Stringer:
		return strings.TrimSpace(v.String()), true
	case json.Number:
		return strings.TrimSpace(v.String()), true
	case float64, float32, int, int64:
		return strings.TrimSpace(fmt.Sprintf("%v", v)), true
	case bool:
		if v {
			return "true", true
		}
		return "false", true
	default:
		return "", false
	}
}

func anySlice[T any](vals []T) []any {
	out := make([]any, len(vals))
	for i, v := range vals {
		out[i] = any(v)
	}
	return out
}
