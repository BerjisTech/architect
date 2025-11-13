export interface RfqRequest {
  id: string;
  requesterUuid: string;
  title: string;
  description?: string | null;
  category: string;
  status: string;
  budgetCents: number;
  currency: string;
  desiredStartDate?: string | null;
  deadlineAt?: string | null;
  createdAt: string;
  updatedAt: string;
  invitations: RfqInvitation[];
  quotes: RfqQuote[];
  messages: RfqMessage[];
}

export interface RfqInvitation {
  id: string;
  requestId: string;
  providerUuid: string;
  listingId?: string | null;
  invitationStatus: string;
  invitedAt: string;
  respondedAt?: string | null;
}

export interface RfqQuote {
  id: string;
  requestId: string;
  providerUuid: string;
  listingId?: string | null;
  version: number;
  amountCents: number;
  currency: string;
  summary?: string | null;
  status: string;
  expiresAt?: string | null;
  submittedAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RfqMessage {
  id: string;
  requestId: string;
  quoteId?: string | null;
  authorUuid: string;
  authorRole: string;
  body: string;
  createdAt: string;
}
