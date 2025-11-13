export interface OnboardingStatus {
  userUuid: string;
  profileType: string;
  stage: string;
  submittedAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  notes?: string | null;
  profileCompleted: boolean;
  verificationStatus: string;
}

export interface Listing {
  id: string;
  userUuid: string;
  title: string;
  summary?: string | null;
  description?: string | null;
  category: string;
  subcategory?: string | null;
  pricingModel: string;
  basePriceCents: number;
  currency: string;
  status: string;
  attributes: Record<string, unknown>;
  previewToken: string;
  publishedAt?: string | null;
  media: ListingMedia[];
  metrics: ListingMetrics;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilitySlot {
  id: string;
  listingId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceArea {
  id: string;
  listingId: string;
  region: string;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Analytics {
  totalListings: number;
  activeListings: number;
  averageResponseMinutes: number;
  totalResponses: number;
  jobsCompleted: number;
}

export interface OnboardingListResponse {
  requests: OnboardingStatus[];
}

export interface ProviderSearchResult {
  listing: Listing;
  displayName?: string | null;
  profileType: string;
  location?: string | null;
  averageRating: number;
  reviewCount: number;
  distanceKm?: number | null;
  score: number;
}

export interface SearchHistoryItem {
  query: string;
  filters: Record<string, unknown>;
  searchedAt: string;
}

export interface ListingMedia {
  id: string;
  listingId: string;
  mediaType: 'image' | 'document';
  title: string;
  description?: string | null;
  url: string;
  previewUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes: number;
  isPrimary: boolean;
  position: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListingMetrics {
  viewCount: number;
  contactCount: number;
  lastViewedAt?: string | null;
  lastContactAt?: string | null;
}
