-- Service category taxonomy and attributes

CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NULL,
    icon TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_subcategories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(category_id, key)
);

CREATE TABLE IF NOT EXISTS service_category_attributes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    data_type TEXT NOT NULL,
    filter_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(category_id, key)
);

ALTER TABLE service_listings
    ADD COLUMN IF NOT EXISTS subcategory TEXT NULL,
    ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_service_listings_category_subcategory
    ON service_listings (category, subcategory);

-- Seed primary categories ------------------------------------------------------

INSERT INTO service_categories (key, name, description, icon)
VALUES
    ('land_property', 'Land & Property Services', 'Surveyors, property agents, and land consultants covering site acquisition and due diligence.', 'map'),
    ('legal_services', 'Legal Services', 'Construction-focused legal professionals handling contracts, permits, and disputes.', 'gavel'),
    ('design_services', 'Design Services', 'Architects, interior designers, and planners delivering concept-to-build designs.', 'architecture'),
    ('construction_services', 'Construction Services', 'General contractors and specialist builders executing construction projects.', 'construction'),
    ('materials_supplies', 'Materials & Supplies', 'Suppliers providing construction materials, finishes, and fixtures.', 'inventory'),
    ('labor_services', 'Labor Services', 'Hands-on specialists and maintenance professionals supporting project delivery.', 'handyman'),
    ('moving_services', 'Moving Services', 'Relocation and logistics partners managing transport, storage, and installations.', 'local_shipping')
ON CONFLICT (key) DO NOTHING;

-- Seed subcategories -----------------------------------------------------------

WITH land AS (
    SELECT id FROM service_categories WHERE key = 'land_property'
)
INSERT INTO service_subcategories (category_id, key, name, description, position)
SELECT id, key, name, description, position FROM land, (VALUES
    ('land_surveying', 'Land Surveying', 'Boundary, topographical, and GIS-focused surveying services.', 0),
    ('property_agency', 'Property Agency', 'Brokers assisting with site acquisition and land transactions.', 1),
    ('property_management', 'Property Management', 'Operations for estates, communities, and mixed-use developments.', 2),
    ('site_feasibility', 'Site Feasibility', 'Consultants producing site analysis, zoning, and feasibility studies.', 3)
) AS data(key, name, description, position)
ON CONFLICT DO NOTHING;

WITH legal AS (
    SELECT id FROM service_categories WHERE key = 'legal_services'
)
INSERT INTO service_subcategories (category_id, key, name, description, position)
SELECT id, key, name, description, position FROM legal, (VALUES
    ('contracts', 'Contract Drafting & Review', 'Agreements for designers, contractors, owners, and suppliers.', 0),
    ('permitting', 'Permitting & Compliance', 'Securing approvals and ensuring code compliance.', 1),
    ('disputes', 'Dispute Resolution', 'Litigation, mediation, and arbitration for construction matters.', 2)
) AS data(key, name, description, position)
ON CONFLICT DO NOTHING;

WITH design AS (
    SELECT id FROM service_categories WHERE key = 'design_services'
)
INSERT INTO service_subcategories (category_id, key, name, description, position)
SELECT id, key, name, description, position FROM design, (VALUES
    ('architectural_design', 'Architectural Design', 'Concept, schematic, and detailed architectural design services.', 0),
    ('interior_design', 'Interior Design', 'Spatial planning, finishes, and FF&E selections.', 1),
    ('landscape_design', 'Landscape & Urban Design', 'Exterior environments, landscaping, and streetscape solutions.', 2),
    ('specialist_design', 'Specialist Design', 'MEP, structural, lighting, and sustainability consultants.', 3)
) AS data(key, name, description, position)
ON CONFLICT DO NOTHING;

WITH construction AS (
    SELECT id FROM service_categories WHERE key = 'construction_services'
)
INSERT INTO service_subcategories (category_id, key, name, description, position)
SELECT id, key, name, description, position FROM construction, (VALUES
    ('general_contracting', 'General Contracting', 'End-to-end project delivery and site management.', 0),
    ('structural_build', 'Structural Works', 'Structural framing, concrete, and steel specialists.', 1),
    ('mep_services', 'MEP Services', 'Mechanical, electrical, plumbing, and fire systems contractors.', 2),
    ('finishing', 'Finishing & Fit-out', 'Interior finishing, cabinetry, and bespoke installations.', 3)
) AS data(key, name, description, position)
ON CONFLICT DO NOTHING;

WITH materials AS (
    SELECT id FROM service_categories WHERE key = 'materials_supplies'
)
INSERT INTO service_subcategories (category_id, key, name, description, position)
SELECT id, key, name, description, position FROM materials, (VALUES
    ('structural_materials', 'Structural Materials', 'Aggregates, cement, rebar, and structural elements.', 0),
    ('finishes', 'Finishes & Fixtures', 'Tiles, flooring, sanitaryware, lighting, and hardware.', 1),
    ('sustainable', 'Sustainable Materials', 'Eco-certified and recycled building products.', 2),
    ('logistics', 'Supply Logistics', 'Just-in-time delivery and warehousing services.', 3)
) AS data(key, name, description, position)
ON CONFLICT DO NOTHING;

WITH labor AS (
    SELECT id FROM service_categories WHERE key = 'labor_services'
)
INSERT INTO service_subcategories (category_id, key, name, description, position)
SELECT id, key, name, description, position FROM labor, (VALUES
    ('handyman', 'Handyman & Repairs', 'Minor works, maintenance, and emergency call-outs.', 0),
    ('specialist_trade', 'Specialist Trades', 'Carpenters, masons, welders, and finishing artisans.', 1),
    ('building_services', 'Building Services', 'Facilities operations, cleaning, and property care.', 2)
) AS data(key, name, description, position)
ON CONFLICT DO NOTHING;

WITH moving AS (
    SELECT id FROM service_categories WHERE key = 'moving_services'
)
INSERT INTO service_subcategories (category_id, key, name, description, position)
SELECT id, key, name, description, position FROM moving, (VALUES
    ('residential_moving', 'Residential Moving', 'Home relocation planning, packing, and transport.', 0),
    ('commercial_moving', 'Commercial Moving', 'Office and industrial relocations with minimal downtime.', 1),
    ('storage', 'Storage & Warehousing', 'Short and long term storage solutions.', 2),
    ('logistics_planning', 'Logistics Planning', 'Special handling, installations, and route planning.', 3)
) AS data(key, name, description, position)
ON CONFLICT DO NOTHING;

-- Seed category attributes -----------------------------------------------------

INSERT INTO service_category_attributes (category_id, key, label, data_type, filter_config, required)
SELECT sc.id, attr.key, attr.label, attr.data_type, attr.filter_config::jsonb, attr.required
FROM service_categories sc
JOIN (
    VALUES
        ('land_property', 'licensed', 'Licensed / Registered', 'boolean', '{"control":"toggle"}', FALSE),
        ('land_property', 'coverage_radius_km', 'Coverage Radius (km)', 'number', '{"control":"range","min":5,"max":500}', FALSE),

        ('legal_services', 'jurisdiction', 'Primary Jurisdiction', 'enum', '{"control":"select","options":["National","State / Regional","Municipal"]}', TRUE),
        ('legal_services', 'practice_focus', 'Practice Focus', 'multiselect', '{"control":"chips","options":["Contracts","Permits","Disputes","Compliance"]}', FALSE),

        ('design_services', 'project_scale', 'Preferred Project Scale', 'multiselect', '{"control":"chips","options":["Residential","Commercial","Industrial","Hospitality","Institutional"]}', FALSE),
        ('design_services', 'software', 'Design Software', 'multiselect', '{"control":"chips","options":["AutoCAD","Revit","ArchiCAD","SketchUp","Rhino","3ds Max"]}', FALSE),

        ('construction_services', 'crew_size', 'Crew Size Capacity', 'enum', '{"control":"select","options":["1-5","6-20","21-50","51+"]}', FALSE),
        ('construction_services', 'has_hse_plan', 'HSE Plan Available', 'boolean', '{"control":"toggle"}', FALSE),

        ('materials_supplies', 'delivery_radius_km', 'Delivery Radius (km)', 'number', '{"control":"range","min":5,"max":1000}', FALSE),
        ('materials_supplies', 'inventory_visibility', 'Inventory Visibility', 'enum', '{"control":"select","options":["Real-time","Daily","Weekly","On Request"]}', FALSE),

        ('labor_services', 'emergency_support', 'Emergency Support Available', 'boolean', '{"control":"toggle"}', FALSE),
        ('labor_services', 'certifications', 'Trade Certifications', 'multiselect', '{"control":"chips","options":["NCA","NEMA","OSHA","ISO","Other"]}', FALSE),

        ('moving_services', 'service_radius_km', 'Service Radius (km)', 'number', '{"control":"range","min":10,"max":2000}', FALSE),
        ('moving_services', 'insurance_level', 'Insurance Coverage', 'enum', '{"control":"select","options":["Basic","Standard","Full Service"]}', FALSE)
) AS attr(category_key, key, label, data_type, filter_config, required)
    ON sc.key = attr.category_key
ON CONFLICT (category_id, key) DO NOTHING;
