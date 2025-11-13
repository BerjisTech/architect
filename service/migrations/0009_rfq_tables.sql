-- Request for Quote (RFQ) core tables

CREATE TABLE IF NOT EXISTS rfq_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_uuid UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    budget_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    desired_start_date DATE NULL,
    deadline_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfq_requests_requester ON rfq_requests (requester_uuid);
CREATE INDEX IF NOT EXISTS idx_rfq_requests_status ON rfq_requests (status);

CREATE TABLE IF NOT EXISTS rfq_request_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
    provider_uuid UUID NOT NULL,
    listing_id UUID NULL REFERENCES service_listings(id) ON DELETE SET NULL,
    invitation_status TEXT NOT NULL DEFAULT 'pending',
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ NULL,
    UNIQUE (request_id, provider_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rfq_request_providers_provider ON rfq_request_providers (provider_uuid);
CREATE INDEX IF NOT EXISTS idx_rfq_request_providers_request ON rfq_request_providers (request_id);

CREATE TABLE IF NOT EXISTS rfq_quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
    provider_uuid UUID NOT NULL,
    listing_id UUID NULL REFERENCES service_listings(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    summary TEXT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    expires_at TIMESTAMPTZ NULL,
    submitted_at TIMESTAMPTZ NULL,
    accepted_at TIMESTAMPTZ NULL,
    rejected_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (request_id, provider_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rfq_quotes_request ON rfq_quotes (request_id);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_provider ON rfq_quotes (provider_uuid);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_status ON rfq_quotes (status);

CREATE TABLE IF NOT EXISTS rfq_quote_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID NOT NULL REFERENCES rfq_quotes(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    summary TEXT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (quote_id, version)
);

CREATE TABLE IF NOT EXISTS rfq_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
    quote_id UUID NULL REFERENCES rfq_quotes(id) ON DELETE CASCADE,
    author_uuid UUID NOT NULL,
    author_role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfq_messages_request ON rfq_messages (request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rfq_messages_quote ON rfq_messages (quote_id, created_at);
