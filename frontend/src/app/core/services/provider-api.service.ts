import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  OnboardingStatus,
  Listing,
  AvailabilitySlot,
  ServiceArea,
  Analytics,
  OnboardingListResponse,
  ProviderSearchResult,
  SearchHistoryItem
} from '../../models/providers';
import { ProviderProfileDefinition } from '../../models/profile-types';
import { ServiceCategory } from '../../models/categories';

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
type CategoriesResponse = ApiResponse<{ categories: ServiceCategory[] }>;
type SearchResponse = ApiResponse<{ results: ProviderSearchResult[]; meta: SearchMeta }>;
type FavoritesResponse = ApiResponse<{ listings: Listing[] }>;
type HistoryResponse = ApiResponse<{ history: SearchHistoryItem[] }>;

interface SearchMeta {
  limit: number;
  offset: number;
  count: number;
}

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

  getCategories(): Observable<CategoriesResponse> {
    return this.http.get<CategoriesResponse>(`${this.base}/categories`, { withCredentials: true });
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

  searchListings(filters: ProviderSearchFilters): Observable<SearchResponse> {
    let params = new HttpParams();
    if (filters.query) {
      params = params.set('q', filters.query);
    }
    (filters.categories ?? []).forEach(category => {
      params = params.append('category', category);
    });
    (filters.subcategories ?? []).forEach(subcategory => {
      params = params.append('subcategory', subcategory);
    });
    (filters.countries ?? []).forEach(country => {
      params = params.append('country', country);
    });
    if (filters.region) {
      params = params.set('region', filters.region);
    }
    if (filters.minPrice != null) {
      params = params.set('minPrice', filters.minPrice.toString());
    }
    if (filters.maxPrice != null) {
      params = params.set('maxPrice', filters.maxPrice.toString());
    }
    if (filters.minRating != null) {
      params = params.set('minRating', filters.minRating.toString());
    }
    if (filters.dayOfWeek != null) {
      params = params.set('dayOfWeek', filters.dayOfWeek.toString());
    }
    if (filters.startMinute != null) {
      params = params.set('startMinute', filters.startMinute.toString());
    }
    if (filters.endMinute != null) {
      params = params.set('endMinute', filters.endMinute.toString());
    }
    if (filters.limit != null) {
      params = params.set('limit', filters.limit.toString());
    }
    if (filters.offset != null) {
      params = params.set('offset', filters.offset.toString());
    }
    return this.http.get<SearchResponse>(`${this.base}/search`, {
      params,
      withCredentials: true
    });
  }

  listFavorites(limit?: number): Observable<FavoritesResponse> {
    let params = new HttpParams();
    if (limit != null) {
      params = params.set('limit', limit.toString());
    }
    return this.http.get<FavoritesResponse>(`${this.base}/favorites`, {
      params,
      withCredentials: true
    });
  }

  addFavorite(listingId: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(
      `${this.base}/favorites/${encodeURIComponent(listingId)}`,
      {},
      { withCredentials: true }
    );
  }

  removeFavorite(listingId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/favorites/${encodeURIComponent(listingId)}`, {
      withCredentials: true
    });
  }

  getSearchHistory(limit?: number): Observable<HistoryResponse> {
    let params = new HttpParams();
    if (limit != null) {
      params = params.set('limit', limit.toString());
    }
    return this.http.get<HistoryResponse>(`${this.base}/search/history`, {
      params,
      withCredentials: true
    });
  }

  getRecommended(limit?: number): Observable<SearchResponse> {
    let params = new HttpParams();
    if (limit != null) {
      params = params.set('limit', limit.toString());
    }
    return this.http.get<SearchResponse>(`${this.base}/recommended`, {
      params,
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
  subcategory?: string | null;
  pricingModel: string;
  basePriceCents: number;
  currency: string;
  status: string;
  attributes?: Record<string, unknown>;
}

export interface AvailabilitySlotRequest {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface ServiceAreaRequest {
  region: string;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
}

export interface ProviderSearchFilters {
  query?: string;
  categories?: string[];
  subcategories?: string[];
  countries?: string[];
  region?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  dayOfWeek?: number;
  startMinute?: number;
  endMinute?: number;
  limit?: number;
  offset?: number;
}
