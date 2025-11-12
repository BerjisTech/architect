import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RouterModule } from '@angular/router';

import {
  ProviderApiService,
  ProviderSearchFilters
} from '../core/services/provider-api.service';
import { ServiceCategory, ServiceSubcategory } from '../models/categories';
import { ProviderSearchResult, SearchHistoryItem } from '../models/providers';

@Component({
  selector: 'arch-matching',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './matching.page.html'
})
export class MatchingPage implements OnInit {
  private readonly api = inject(ProviderApiService);
  private readonly fb = inject(FormBuilder);

  filtersForm: FormGroup = this.fb.group({
    query: [''],
    category: [''],
    subcategory: [''],
    region: [''],
    country: [''],
    latitude: [null],
    longitude: [null],
    radiusKm: [null],
    minPrice: [null],
    maxPrice: [null],
    minRating: [null],
    dayOfWeek: [null],
    startMinute: [null],
    endMinute: [null]
  });

  categories: ServiceCategory[] = [];
  subcategories: ServiceSubcategory[] = [];

  results: ProviderSearchResult[] = [];
  resultMeta = { limit: 20, offset: 0, count: 0 };
  recommended: ProviderSearchResult[] = [];
  history: SearchHistoryItem[] = [];
  favorites = new Set<string>();
  favoriteProcessing = new Set<string>();

  loading = false;
  locationLoading = false;
  initialized = false;
  error: string | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadCategories();
    this.filtersForm.get('category')?.valueChanges.subscribe(value => {
      this.onCategoryChanged(typeof value === 'string' ? value : '');
    });
    await this.search();
    await Promise.all([this.loadSearchHistory(), this.loadRecommendations()]);
    this.initialized = true;
  }

  async search(): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      const filters = this.buildFilters();
      const response = await firstValueFrom(this.api.searchListings(filters));
      this.results = response.data.results ?? [];
      const meta = response.data.meta ?? { limit: 20, offset: 0, count: this.results.length };
      this.resultMeta = {
        limit: meta.limit ?? 20,
        offset: meta.offset ?? 0,
        count: meta.count ?? this.results.length
      };
      this.refreshFavoritesSet();
      void this.loadRecommendations();
    } catch (error) {
      console.error('Failed to search providers', error);
      this.error = 'Unable to search providers right now.';
      this.results = [];
      this.resultMeta = { limit: 20, offset: 0, count: 0 };
    } finally {
      this.loading = false;
    }
  }

  async resetFilters(): Promise<void> {
    this.filtersForm.reset({
      query: '',
      category: this.categories[0]?.key ?? '',
      subcategory: '',
      region: '',
      country: '',
      latitude: null,
      longitude: null,
      radiusKm: null,
      minPrice: null,
      maxPrice: null,
      minRating: null,
      dayOfWeek: null,
      startMinute: null,
      endMinute: null
    });
    this.resultMeta.offset = 0;
    await this.search();
  }

  async useMyLocation(): Promise<void> {
    if (!('geolocation' in navigator)) {
      return;
    }
    this.locationLoading = true;
    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude } = position.coords;
        this.filtersForm.patchValue({
          latitude,
          longitude,
          radiusKm: this.filtersForm.value.radiusKm ?? 50
        });
        this.locationLoading = false;
      },
      error => {
        console.warn('Geolocation error', error);
        this.locationLoading = false;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  applyHistory(item: SearchHistoryItem): void {
    const filters = item.filters ?? {};
    const categories = (filters['categories'] as string[] | undefined) ?? [];
    const subcategories = (filters['subcategories'] as string[] | undefined) ?? [];
    const countries = (filters['countries'] as string[] | undefined) ?? [];
    const latitude = typeof filters['latitude'] === 'number' ? (filters['latitude'] as number) : null;
    const longitude = typeof filters['longitude'] === 'number' ? (filters['longitude'] as number) : null;
    const radius = typeof filters['radiusKm'] === 'number' ? (filters['radiusKm'] as number) : null;
    const minPriceCents = typeof filters['minPriceCents'] === 'number' ? (filters['minPriceCents'] as number) : null;
    const maxPriceCents = typeof filters['maxPriceCents'] === 'number' ? (filters['maxPriceCents'] as number) : null;
    const minRating = typeof filters['minRating'] === 'number' ? (filters['minRating'] as number) : null;
    this.filtersForm.patchValue({
      query: item.query ?? '',
      category: categories[0] ?? this.categories[0]?.key ?? '',
      subcategory: subcategories[0] ?? '',
      region: (filters['region'] as string | undefined) ?? '',
      country: countries[0] ?? '',
      latitude,
      longitude,
      radiusKm: radius,
      minPrice: minPriceCents != null ? minPriceCents / 100 : null,
      maxPrice: maxPriceCents != null ? maxPriceCents / 100 : null,
      minRating
    });
  }

  async toggleFavorite(result: ProviderSearchResult): Promise<void> {
    const listingId = result.listing.id;
    if (this.favoriteProcessing.has(listingId)) {
      return;
    }
    this.favoriteProcessing.add(listingId);
    try {
      if (this.favorites.has(listingId)) {
        await firstValueFrom(this.api.removeFavorite(listingId));
        this.favorites.delete(listingId);
        result.listing.attributes = { ...result.listing.attributes, favorited: false };
      } else {
        await firstValueFrom(this.api.addFavorite(listingId));
        this.favorites.add(listingId);
        result.listing.attributes = { ...result.listing.attributes, favorited: true };
      }
    } catch (error) {
      console.error('Failed to toggle favorite', error);
    } finally {
      this.favoriteProcessing.delete(listingId);
    }
  }

  isFavorited(result: ProviderSearchResult): boolean {
    return this.favorites.has(result.listing.id) || !!result.listing.attributes?.['favorited'];
  }

  categoryLabel(result: ProviderSearchResult): string {
    const category = this.categories.find(cat => cat.key === result.listing.category);
    return category?.name ?? this.toTitleCase(result.listing.category ?? '');
  }

  subcategoryLabel(result: ProviderSearchResult): string | null {
    if (!result.listing.subcategory) {
      return null;
    }
    const category = this.categories.find(cat => cat.key === result.listing.category);
    const sub = category?.subcategories.find(s => s.key === result.listing.subcategory);
    return sub?.name ?? this.toTitleCase(result.listing.subcategory);
  }

  private async loadCategories(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getCategories());
      this.categories = response.data.categories ?? [];
      const defaultCategory = this.categories[0]?.key ?? '';
      this.filtersForm.patchValue(
        { category: defaultCategory },
        { emitEvent: false }
      );
      this.onCategoryChanged(defaultCategory);
    } catch (error) {
      console.error('Failed to load service categories', error);
      this.categories = [];
      this.subcategories = [];
      this.error = 'Unable to load service categories.';
    }
  }

  private onCategoryChanged(categoryKey: string): void {
    const category = this.categories.find(cat => cat.key === categoryKey);
    this.subcategories = category?.subcategories ?? [];
    const current = this.filtersForm.get('subcategory')?.value as string | null;
    if (current && !this.subcategories.some(sub => sub.key === current)) {
      this.filtersForm.patchValue({ subcategory: '' }, { emitEvent: false });
    }
  }

  private buildFilters(): ProviderSearchFilters {
    const value = this.filtersForm.value;
    const filters: ProviderSearchFilters = {
      limit: this.resultMeta.limit,
      offset: this.resultMeta.offset
    };
    const query = (value.query as string | null)?.trim();
    if (query) {
      filters.query = query;
    }
    const category = (value.category as string | null)?.trim();
    if (category) {
      filters.categories = [category];
    }
    const subcategory = (value.subcategory as string | null)?.trim();
    if (subcategory) {
      filters.subcategories = [subcategory];
    }
    const region = (value.region as string | null)?.trim();
    if (region) {
      filters.region = region;
    }
    const country = (value.country as string | null)?.trim();
    if (country) {
      filters.countries = [country.toLowerCase()];
    }
    const latitude = this.toNumber(value.latitude);
    if (latitude != null) {
      filters.latitude = latitude;
    }
    const longitude = this.toNumber(value.longitude);
    if (longitude != null) {
      filters.longitude = longitude;
    }
    const radiusKm = this.toNumber(value.radiusKm);
    if (radiusKm != null) {
      filters.radiusKm = radiusKm;
    }
    const minPrice = this.toNumber(value.minPrice);
    if (minPrice != null) {
      filters.minPrice = minPrice;
    }
    const maxPrice = this.toNumber(value.maxPrice);
    if (maxPrice != null) {
      filters.maxPrice = maxPrice;
    }
    const minRating = this.toNumber(value.minRating);
    if (minRating != null) {
      filters.minRating = minRating;
    }
    const dayOfWeek = this.toInteger(value.dayOfWeek);
    if (dayOfWeek != null) {
      filters.dayOfWeek = dayOfWeek;
    }
    const startMinute = this.toInteger(value.startMinute);
    if (startMinute != null) {
      filters.startMinute = startMinute;
    }
    const endMinute = this.toInteger(value.endMinute);
    if (endMinute != null) {
      filters.endMinute = endMinute;
    }
    return filters;
  }

  private toNumber(input: unknown): number | null {
    if (input === null || input === undefined || input === '') {
      return null;
    }
    const num = Number(input);
    return Number.isFinite(num) ? num : null;
  }

  private toInteger(input: unknown): number | null {
    if (input === null || input === undefined || input === '') {
      return null;
    }
    const num = Number(input);
    return Number.isInteger(num) ? num : null;
  }

  private toTitleCase(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .map(part => (part ? part[0].toUpperCase() + part.slice(1) : ''))
      .join(' ')
      .trim();
  }

  private async loadSearchHistory(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getSearchHistory());
      this.history = response.data.history ?? [];
    } catch {
      // Ignore auth errors (user might be anonymous)
      this.history = [];
    }
  }

  private async loadRecommendations(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getRecommended(8));
      this.recommended = response.data.results ?? [];
      this.refreshFavoritesSet(this.recommended);
    } catch {
      this.recommended = [];
    }
  }

  private refreshFavoritesSet(extraResults: ProviderSearchResult[] = []): void {
    const combined = [...this.results, ...extraResults];
    const next = new Set<string>();
    for (const result of combined) {
      if (result.listing.attributes?.['favorited']) {
        next.add(result.listing.id);
      }
    }
    for (const id of this.favorites) {
      if (!next.has(id)) {
        next.add(id);
      }
    }
    this.favorites = next;
  }
}
