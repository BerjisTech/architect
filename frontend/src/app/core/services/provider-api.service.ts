import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  OnboardingStatus,
  Listing,
  AvailabilitySlot,
  ServiceArea,
  Analytics,
  OnboardingListResponse
} from '../../models/providers';
import { ProviderProfileDefinition } from '../../models/profile-types';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

type OnboardingResponse = ApiResponse<{ status: OnboardingStatus | null }>;
type ListingsResponse = ApiResponse<{ listings: Listing[] }>;
type ListingResponse = ApiResponse<{ listing: Listing }>;
type AvailabilityResponse = ApiResponse<{ slots: AvailabilitySlot[] }>;
type ServiceAreaResponse = ApiResponse<{ areas: ServiceArea[] }>;
type AnalyticsResponse = ApiResponse<{ analytics: Analytics }>;
type PendingResponse = ApiResponse<OnboardingListResponse>;

@Injectable({ providedIn: 'root' })
export class ProviderApiService {
  private readonly base = '/svc/v1/providers';

  constructor(private readonly http: HttpClient) {}

  submitOnboarding(profileType: ProviderProfileDefinition['type']): Observable<OnboardingResponse> {
    return this.http.post<OnboardingResponse>(
      `${this.base}/onboarding`,
      { profileType },
      { withCredentials: true }
    );
  }

  getOnboardingStatus(): Observable<OnboardingResponse> {
    return this.http.get<OnboardingResponse>(`${this.base}/onboarding/status`, { withCredentials: true });
  }

  listPendingOnboarding(): Observable<PendingResponse> {
    return this.http.get<PendingResponse>(`${this.base}/onboarding/pending`, { withCredentials: true });
  }

  reviewOnboarding(userUuid: string, stage: string, notes?: string | null): Observable<OnboardingResponse> {
    return this.http.post<OnboardingResponse>(
      `${this.base}/onboarding/${encodeURIComponent(userUuid)}/review`,
      { stage, notes },
      { withCredentials: true }
    );
  }

  listMyListings(): Observable<ListingsResponse> {
    return this.http.get<ListingsResponse>(`${this.base}/me/listings`, { withCredentials: true });
  }

  listPublicListings(params?: { limit?: number }): Observable<ListingsResponse> {
    let httpParams = new HttpParams();
    if (params?.limit != null) {
      httpParams = httpParams.set('limit', params.limit);
    }
    return this.http.get<ListingsResponse>(`${this.base}/listings`, {
      params: httpParams,
      withCredentials: true
    });
  }

  createListing(payload: ListingRequest): Observable<ListingResponse> {
    return this.http.post<ListingResponse>(`${this.base}/listings`, payload, { withCredentials: true });
  }

  updateListing(id: string, payload: ListingRequest): Observable<ListingResponse> {
    return this.http.put<ListingResponse>(`${this.base}/listings/${encodeURIComponent(id)}`, payload, {
      withCredentials: true
    });
  }

  deleteListing(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/listings/${encodeURIComponent(id)}`, {
      withCredentials: true
    });
  }

  getAvailability(listingId: string): Observable<AvailabilityResponse> {
    return this.http.get<AvailabilityResponse>(
      `${this.base}/listings/${encodeURIComponent(listingId)}/availability`,
      { withCredentials: true }
    );
  }

  setAvailability(listingId: string, slots: AvailabilitySlotRequest[]): Observable<ApiResponse<unknown>> {
    return this.http.put<ApiResponse<unknown>>(
      `${this.base}/listings/${encodeURIComponent(listingId)}/availability`,
      { slots },
      { withCredentials: true }
    );
  }

  getServiceAreas(listingId: string): Observable<ServiceAreaResponse> {
    return this.http.get<ServiceAreaResponse>(
      `${this.base}/listings/${encodeURIComponent(listingId)}/areas`,
      { withCredentials: true }
    );
  }

  setServiceAreas(listingId: string, areas: ServiceAreaRequest[]): Observable<ApiResponse<unknown>> {
    return this.http.put<ApiResponse<unknown>>(
      `${this.base}/listings/${encodeURIComponent(listingId)}/areas`,
      { areas },
      { withCredentials: true }
    );
  }

  recordResponseEvent(elapsedMinutes: number, jobCompleted: boolean): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(
      `${this.base}/response-events`,
      { elapsedMinutes, jobCompleted },
      { withCredentials: true }
    );
  }

  getAnalytics(): Observable<AnalyticsResponse> {
    return this.http.get<AnalyticsResponse>(`${this.base}/analytics`, { withCredentials: true });
  }
}

export interface ListingRequest {
  title: string;
  summary?: string | null;
  description?: string | null;
  category: string;
  pricingModel: string;
  basePriceCents: number;
  currency: string;
  status: string;
}

export interface AvailabilitySlotRequest {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface ServiceAreaRequest {
  region: string;
  countryCode?: string | null;
  notes?: string | null;
}
