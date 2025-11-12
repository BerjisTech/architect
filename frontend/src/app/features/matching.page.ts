import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  ProviderApiService,
  ProviderSearchFilters
} from '../core/services/provider-api.service';
import { ServiceCategory, ServiceSubcategory } from '../models/categories';
import { ProviderSearchResult } from '../models/providers';

@Component({
  selector: 'arch-matching',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
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

  loading = false;
  initialized = false;
  error: string | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadCategories();
    this.filtersForm.get('category')?.valueChanges.subscribe(value => {
      this.onCategoryChanged(typeof value === 'string' ? value : '');
    });
    await this.search();
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
      minPrice: null,
      maxPrice: null,
      minRating: null,
      dayOfWeek: null,
      startMinute: null,
      endMinute: null
    });
    await this.search();
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
      filters.countries = [country];
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
    const num = Number(input);
    return Number.isFinite(num) ? num : null;
  }

  private toInteger(input: unknown): number | null {
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
}
