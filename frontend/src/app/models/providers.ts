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
}
