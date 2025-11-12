import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Profile,
  PortfolioItem,
  PortfolioResponse,
  Certification,
  CertificationsResponse,
  Review,
  ReviewsResponse
} from '../../models/profile';
import { ArchitectProfileType } from '../../models/profile-types';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

type ProfileResponse = ApiResponse<{ profile: Profile }>;
type PortfolioItemResponse = ApiResponse<{ item: PortfolioItem }>;
type CertificationItemResponse = ApiResponse<{ item: Certification }>;
type ReviewItemResponse = ApiResponse<{ item: Review }>;

@Injectable({ providedIn: 'root' })
export class ProfileApiService {
  private readonly base = '/svc/v1/profiles';

  constructor(private readonly http: HttpClient) {}

  getMyProfile(): Observable<ProfileResponse> {
    return this.http.get<ProfileResponse>(`${this.base}/me`, { withCredentials: true });
  }

  updateMyProfile(payload: {
    profileType?: ArchitectProfileType;
    displayName?: string | null;
    headline?: string | null;
    companyName?: string | null;
    phone?: string | null;
    website?: string | null;
    location?: string | null;
    bio?: string | null;
    specialties?: string[];
    avatarUrl?: string | null;
    isPublic?: boolean;
  }): Observable<ProfileResponse> {
    return this.http.put<ProfileResponse>(`${this.base}/me`, payload, { withCredentials: true });
  }

  deleteMyProfile(hard = false): Observable<ApiResponse<unknown>> {
    const params = new HttpParams().set('hard', hard ? 'true' : 'false');
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/me`, { params, withCredentials: true });
  }

  getPublicProfile(userUuid: string): Observable<ProfileResponse> {
    return this.http.get<ProfileResponse>(`${this.base}/${encodeURIComponent(userUuid)}`, { withCredentials: true });
  }

  // Portfolio
  listMyPortfolio(): Observable<ApiResponse<PortfolioResponse>> {
    return this.http.get<ApiResponse<PortfolioResponse>>(`${this.base}/me/portfolio`, { withCredentials: true });
  }

  listPublicPortfolio(userUuid: string): Observable<ApiResponse<PortfolioResponse>> {
    return this.http.get<ApiResponse<PortfolioResponse>>(
      `${this.base}/${encodeURIComponent(userUuid)}/portfolio`,
      { withCredentials: true }
    );
  }

  savePortfolioItem(payload: {
    id?: string;
    title: string;
    description?: string | null;
    mediaUrl?: string | null;
    tags?: string[];
    isPublic?: boolean;
    position?: number;
  }): Observable<PortfolioItemResponse> {
    if (payload.id) {
      const id = payload.id;
      const body = { ...payload };
      delete body.id;
      return this.http.put<PortfolioItemResponse>(`${this.base}/me/portfolio/${encodeURIComponent(id)}`, body, {
        withCredentials: true
      });
    }
    return this.http.post<PortfolioItemResponse>(`${this.base}/me/portfolio`, payload, { withCredentials: true });
  }

  deletePortfolioItem(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/me/portfolio/${encodeURIComponent(id)}`, {
      withCredentials: true
    });
  }

  // Certifications
  listMyCertifications(): Observable<ApiResponse<CertificationsResponse>> {
    return this.http.get<ApiResponse<CertificationsResponse>>(`${this.base}/me/certifications`, {
      withCredentials: true
    });
  }

  listPublicCertifications(userUuid: string): Observable<ApiResponse<CertificationsResponse>> {
    return this.http.get<ApiResponse<CertificationsResponse>>(
      `${this.base}/${encodeURIComponent(userUuid)}/certifications`,
      { withCredentials: true }
    );
  }

  saveCertification(payload: {
    id?: string;
    name: string;
    issuer?: string | null;
    issuedOn?: string | null;
    expiresOn?: string | null;
    credentialId?: string | null;
    credentialUrl?: string | null;
  }): Observable<CertificationItemResponse> {
    if (payload.id) {
      const id = payload.id;
      const body = { ...payload };
      delete body.id;
      return this.http.put<CertificationItemResponse>(`${this.base}/me/certifications/${encodeURIComponent(id)}`, body, {
        withCredentials: true
      });
    }
    return this.http.post<CertificationItemResponse>(`${this.base}/me/certifications`, payload, {
      withCredentials: true
    });
  }

  deleteCertification(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/me/certifications/${encodeURIComponent(id)}`, {
      withCredentials: true
    });
  }

  updateCertificationStatus(
    userUuid: string,
    certificationId: string,
    payload: { status: string; notes?: string | null }
  ): Observable<CertificationItemResponse> {
    return this.http.post<CertificationItemResponse>(
      `${this.base}/${encodeURIComponent(userUuid)}/certifications/${encodeURIComponent(certificationId)}/status`,
      payload,
      { withCredentials: true }
    );
  }

  // Reviews
  listPublicReviews(userUuid: string): Observable<ApiResponse<ReviewsResponse>> {
    return this.http.get<ApiResponse<ReviewsResponse>>(`${this.base}/${encodeURIComponent(userUuid)}/reviews`, {
      withCredentials: true
    });
  }

  listMyReviews(): Observable<ApiResponse<ReviewsResponse>> {
    return this.http.get<ApiResponse<ReviewsResponse>>(`${this.base}/me/reviews`, { withCredentials: true });
  }

  createReview(userUuid: string, payload: { rating: number; title?: string | null; comment?: string | null; isPublic?: boolean }): Observable<ReviewItemResponse> {
    return this.http.post<ReviewItemResponse>(
      `${this.base}/${encodeURIComponent(userUuid)}/reviews`,
      payload,
      { withCredentials: true }
    );
  }

  deleteReview(userUuid: string, reviewId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(
      `${this.base}/${encodeURIComponent(userUuid)}/reviews/${encodeURIComponent(reviewId)}`,
      { withCredentials: true }
    );
  }

  setVerificationStatus(userUuid: string, payload: { status: string; notes?: string | null }): Observable<ProfileResponse> {
    return this.http.post<ProfileResponse>(
      `${this.base}/${encodeURIComponent(userUuid)}/verification`,
      payload,
      { withCredentials: true }
    );
  }
}
