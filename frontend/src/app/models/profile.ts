export interface ReviewSummary {
  average: number;
  count: number;
}

export interface PortfolioItem {
  id: string;
  userUuid: string;
  title: string;
  description?: string | null;
  mediaUrl?: string | null;
  tags: string[];
  isPublic: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Certification {
  id: string;
  userUuid: string;
  name: string;
  issuer?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  credentialId?: string | null;
  credentialUrl?: string | null;
  status: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  userUuid: string;
  reviewerUuid: string;
  rating: number;
  title?: string | null;
  comment?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  userUuid: string;
  profileType: string;
  displayName?: string | null;
  headline?: string | null;
  companyName?: string | null;
  phone?: string | null;
  website?: string | null;
  location?: string | null;
  bio?: string | null;
  specialties: string[];
  avatarUrl?: string | null;
  isPublic: boolean;
  completionScore: number;
  completionSections: Record<string, boolean>;
  verificationStatus: string;
  verificationNotes?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  portfolio: PortfolioItem[];
  certifications: Certification[];
  reviewSummary: ReviewSummary;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewsResponse {
  items: Review[];
}

export interface PortfolioResponse {
  items: PortfolioItem[];
}

export interface CertificationsResponse {
  items: Certification[];
}
