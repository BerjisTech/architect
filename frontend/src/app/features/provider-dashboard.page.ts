import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ProviderApiService, ListingRequest, ServiceAreaRequest, AvailabilitySlotRequest } from '../core/services/provider-api.service';
import { Listing, AvailabilitySlot, ServiceArea, Analytics, ListingMedia } from '../models/providers';
import { ServiceCategory, ServiceSubcategory, CategoryAttribute } from '../models/categories';
import { RichTextEditorComponent } from '../shared/components/rich-text-editor/rich-text-editor.component';

const PRICING_MODELS = ['fixed', 'hourly', 'per_project'];
const STATUSES = ['pending', 'active', 'inactive'];

@Component({
  selector: 'app-provider-dashboard-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RichTextEditorComponent],
  templateUrl: './provider-dashboard.page.html',
  styleUrls: ['./provider-dashboard.page.css']
})
export class ProviderDashboardPage implements OnInit {
  private readonly api = inject(ProviderApiService);
  private readonly fb = inject(FormBuilder);

  listings: Listing[] = [];
  availability: AvailabilitySlot[] = [];
  serviceAreas: ServiceArea[] = [];
  analytics: Analytics | null = null;
  categories: ServiceCategory[] = [];
  subcategoryOptions: ServiceSubcategory[] = [];
  attributeDefinitions: CategoryAttribute[] = [];
  attributeForm: FormGroup = this.fb.group({});

  selectedListing: Listing | null = null;
  loading = true;
  saving = false;
  recording = false;
  error: string | null = null;
  providerAccessBlocked = false;
  uploadingMedia = false;
  mediaError: string | null = null;

  readonly dayOptions = [0, 1, 2, 3, 4, 5, 6];
  readonly dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  readonly dayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  listingForm = this.fb.group({
    id: [''],
    title: ['', Validators.required],
    summary: [''],
    description: [''],
    category: ['', Validators.required],
    subcategory: [''],
    pricingModel: ['fixed', Validators.required],
    basePrice: [0, [Validators.required, Validators.min(0)]],
    currency: ['USD', [Validators.required, Validators.minLength(3)]],
    status: ['pending', Validators.required]
  });

  availabilityForm = this.fb.group({
    dayOfWeek: [0, [Validators.required, Validators.min(0), Validators.max(6)]],
    startMinute: [540, [Validators.required, Validators.min(0), Validators.max(1440)]],
    endMinute: [1020, [Validators.required, Validators.min(0), Validators.max(1440)]]
  });

  areaForm = this.fb.group({
    region: ['', Validators.required],
    countryCode: [''],
    latitude: [null, [Validators.min(-90), Validators.max(90)]],
    longitude: [null, [Validators.min(-180), Validators.max(180)]],
    notes: ['']
  });

  responseForm = this.fb.group({
    elapsedMinutes: [0, [Validators.required, Validators.min(0)]],
    jobCompleted: [false]
  });

  get pricingModels(): string[] {
    return PRICING_MODELS;
  }

  get statuses(): string[] {
    return STATUSES;
  }

  async ngOnInit(): Promise<void> {
    await this.loadCategories();
    this.setupCategoryWatcher();
    await this.loadListings();
  }

  private async loadCategories(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getCategories());
      this.categories = response.data.categories ?? [];
    } catch (error) {
      console.error('Failed to load categories', error);
      this.categories = [];
      this.error = this.error ?? 'Unable to load service categories.';
    }
    this.ensureDefaultCategory();
  }

  private setupCategoryWatcher(): void {
    const categoryControl = this.listingForm.get('category');
    if (!categoryControl) {
      return;
    }
    categoryControl.valueChanges.subscribe(value => {
      this.onCategoryChanged(typeof value === 'string' ? value : '', undefined);
    });
  }

  private ensureDefaultCategory(): void {
    const control = this.listingForm.get('category');
    if (!control) {
      return;
    }
    const current = control.value as string | null;
    if ((!current || current.trim() === '') && this.categories.length > 0) {
      control.setValue(this.categories[0].key, { emitEvent: true });
    }
  }

  private async loadListings(): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      const response = await firstValueFrom(this.api.listMyListings());
      this.providerAccessBlocked = false;
      this.listings = (response.data.listings ?? []).map(listing => this.enhanceListing(listing));
      if (this.listings.length > 0) {
        this.selectListing(this.listings[0]);
      } else {
        this.selectListing(null);
      }
      await this.loadAnalytics();
    } catch (error) {
      console.error('Failed to load listings', error);
      this.listings = [];
      this.selectListing(null);
      this.analytics = null;
      if (this.isForbiddenError(error)) {
        this.providerAccessBlocked = true;
        this.error = 'Provider access is not yet enabled. Complete onboarding and await approval.';
      } else {
        this.error = 'Unable to load listings.';
      }
    } finally {
      this.loading = false;
    }
  }

  selectListing(listing: Listing | null): void {
    this.mediaError = null;
    this.uploadingMedia = false;
    this.selectedListing = listing;
    if (!listing) {
      this.listingForm.reset(
        {
          id: '',
          title: '',
          summary: '',
          description: '',
          category: this.categories[0]?.key ?? '',
        subcategory: '',
        pricingModel: 'fixed',
        basePrice: 0,
        currency: 'USD',
        status: 'pending'
      },
      { emitEvent: false }
    );
      const categoryKey = (this.listingForm.value.category as string) ?? '';
      this.onCategoryChanged(categoryKey, {});
      this.availability = [];
      this.serviceAreas = [];
      return;
    }
    const enriched = this.enhanceListing(listing);
    this.selectedListing = enriched;
    this.listingForm.reset(
      {
        id: enriched.id,
        title: enriched.title,
        summary: enriched.summary ?? '',
        description: enriched.description ?? '',
        category: enriched.category ?? '',
        subcategory: enriched.subcategory ?? '',
        pricingModel: enriched.pricingModel ?? 'fixed',
        basePrice: enriched.basePriceCents / 100,
        currency: enriched.currency ?? 'USD',
        status: enriched.status ?? 'pending'
      },
      { emitEvent: false }
    );
    this.onCategoryChanged(enriched.category ?? '', enriched.attributes ?? {});
    if (
      enriched.subcategory &&
      !this.subcategoryOptions.some(option => option.key === enriched.subcategory)
    ) {
      this.listingForm.patchValue({ subcategory: '' }, { emitEvent: false });
    }
    this.availability = [];
    this.serviceAreas = [];
    this.loadAvailability(enriched.id);
    this.loadServiceAreas(enriched.id);
  }

  async saveListing(): Promise<void> {
    if (this.listingForm.invalid) {
      this.listingForm.markAllAsTouched();
      return;
    }
    if (this.attributeForm.invalid) {
      this.attributeForm.markAllAsTouched();
      this.error = 'Please complete required category attributes.';
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      const value = this.listingForm.value;
      const rawCategory = (value.category ?? '').toString();
      const category = rawCategory.trim() !== '' ? rawCategory : this.categories[0]?.key ?? '';
      const payload: ListingRequest = {
        title: value.title ?? '',
        summary: emptyToNull(value.summary),
        description: emptyToNull(value.description),
        category,
        pricingModel: value.pricingModel ?? 'fixed',
        basePriceCents: Math.round((value.basePrice ?? 0) * 100),
        currency: (value.currency ?? 'USD').toUpperCase(),
        status: value.status ?? 'pending'
      };
      const subcategory = emptyToNull(value.subcategory);
      if (subcategory !== undefined) {
        payload.subcategory = subcategory;
      }
      const attributes = this.buildAttributesPayload();
      if (Object.keys(attributes).length > 0) {
        payload.attributes = attributes;
      } else {
        payload.attributes = {};
      }
      if (value.id) {
        await firstValueFrom(this.api.updateListing(value.id, payload));
      } else {
        await firstValueFrom(this.api.createListing(payload));
      }
      await this.loadListings();
    } catch (error) {
      console.error('Failed to save listing', error);
      this.error = 'Failed to save listing.';
    } finally {
      this.saving = false;
    }
  }

  private onCategoryChanged(categoryKey: string, seed?: Record<string, unknown>): void {
    let key = (categoryKey ?? '').trim().toLowerCase();
    let category = this.categories.find(cat => cat.key === key);
    if (!category && this.categories.length > 0) {
      category = this.categories[0];
      key = category.key;
      this.listingForm.patchValue({ category: key }, { emitEvent: false });
    }
    this.attributeDefinitions = category?.attributes ?? [];
    this.subcategoryOptions = category?.subcategories ?? [];
    const subControl = this.listingForm.get('subcategory');
    if (subControl && subControl.value) {
      const current = (subControl.value as string).trim().toLowerCase();
      if (!this.subcategoryOptions.some(option => option.key === current)) {
        subControl.setValue('', { emitEvent: false });
      }
    }
    if (!category || this.attributeDefinitions.length === 0) {
      this.attributeForm = this.fb.group({});
      return;
    }
    this.buildAttributeForm(this.attributeDefinitions, seed ?? {});
  }

  private buildAttributeForm(defs: CategoryAttribute[], seed: Record<string, unknown>): void {
    const controls: Record<string, FormControl> = {};
    for (const def of defs) {
      const validators = def.required ? [Validators.required] : [];
      controls[def.key] = this.fb.control(this.coerceAttributeValue(def, seed[def.key]), validators);
    }
    this.attributeForm = this.fb.group(controls);
  }

  private coerceAttributeValue(def: CategoryAttribute, value: unknown): unknown {
    switch (def.dataType) {
      case 'boolean':
        if (typeof value === 'boolean') {
          return value;
        }
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true';
        }
        return false;
      case 'number':
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      case 'multiselect':
        return toStringArray(value);
      case 'enum':
      case 'string':
      default:
        if (typeof value === 'string') {
          return value;
        }
        return '';
    }
  }

  private buildAttributesPayload(): Record<string, unknown> {
    if (!this.attributeDefinitions.length || !this.attributeForm) {
      return {};
    }
    const rawValues = this.attributeForm.getRawValue() as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    for (const def of this.attributeDefinitions) {
      const raw = rawValues[def.key];
      switch (def.dataType) {
        case 'boolean':
          payload[def.key] = raw === true;
          break;
        case 'number': {
          const num =
            typeof raw === 'number'
              ? raw
              : typeof raw === 'string' && raw.trim() !== ''
                ? Number(raw)
                : null;
          if (num != null && Number.isFinite(num)) {
            payload[def.key] = num;
          }
          break;
        }
        case 'multiselect': {
          const values = toStringArray(raw);
          if (values.length > 0) {
            payload[def.key] = values;
          }
          break;
        }
        case 'enum':
        case 'string':
        default: {
          const str = typeof raw === 'string' ? raw.trim() : '';
          if (str.length > 0) {
            payload[def.key] = str;
          }
          break;
        }
      }
    }
    return payload;
  }

  categoryLabel(listing: Listing): string {
    const category = this.categories.find(cat => cat.key === listing.category);
    return category?.name ?? this.toTitleCase(listing.category ?? '');
  }

  subcategoryLabel(listing: Listing): string {
    if (!listing.subcategory) {
      return 'Not specified';
    }
    const category = this.categories.find(cat => cat.key === listing.category);
    const sub = category?.subcategories.find(s => s.key === listing.subcategory);
    return sub?.name ?? this.toTitleCase(listing.subcategory);
  }

  attributeOptions(attribute: CategoryAttribute): string[] {
    const options = attribute.filterConfig?.['options'];
    if (Array.isArray(options)) {
      return options.map(option => option as string);
    }
    return [];
  }

  attributeControl(attribute: CategoryAttribute): FormControl {
    let control = this.attributeForm.get(attribute.key) as FormControl | null;
    if (!control) {
      const validators = attribute.required ? [Validators.required] : [];
      control = this.fb.control(this.coerceAttributeValue(attribute, undefined), validators);
      this.attributeForm.addControl(attribute.key, control);
    }
    return control;
  }

  formatPricingModel(model: string | null | undefined): string {
    const value = (model ?? 'fixed').replace(/-/g, '_');
    return this.toTitleCase(value);
  }

  async handleMediaSelection(event: Event): Promise<void> {
    if (!this.selectedListing) {
      return;
    }
    const input = event.target as HTMLInputElement | null;
    const files = input?.files ? Array.from(input.files) : [];
    if (!files.length) {
      return;
    }
    this.mediaError = null;
    this.uploadingMedia = true;
    try {
      let working = this.selectedListing;
      for (const file of files) {
        const mediaType = this.resolveMediaType(file);
        if (!mediaType) {
          this.mediaError = `${file.name} is not a supported format.`;
          continue;
        }
        const shouldBePrimary =
          mediaType === 'image' && !working.media.some(item => item.mediaType === 'image');
        const response = await firstValueFrom(
          this.api.uploadListingMedia(working.id, file, {
            mediaType,
            isPrimary: shouldBePrimary
          })
        );
        const media = response.data.media;
        if (!media) {
          continue;
        }
        working = this.integrateMedia(working, media);
        this.selectedListing = working;
        this.updateListingCollection(working);
      }
    } catch (error) {
      console.error('Failed to upload media', error);
      this.mediaError = 'Unable to upload media at this time.';
    } finally {
      this.uploadingMedia = false;
      if (input) {
        input.value = '';
      }
    }
  }

  async deleteMedia(media: ListingMedia): Promise<void> {
    if (!this.selectedListing) {
      return;
    }
    this.mediaError = null;
    try {
      await firstValueFrom(this.api.deleteListingMedia(this.selectedListing.id, media.id));
      const remaining = this.selectedListing.media.filter(item => item.id !== media.id);
      const updated = { ...this.selectedListing, media: this.sortMedia(remaining) };
      this.selectedListing = updated;
      this.updateListingCollection(updated);
    } catch (error) {
      console.error('Failed to delete media', error);
      this.mediaError = 'Failed to delete media.';
    }
  }

  async setPrimaryMedia(media: ListingMedia): Promise<void> {
    if (!this.selectedListing) {
      return;
    }
    this.mediaError = null;
    try {
      const response = await firstValueFrom(
        this.api.setPrimaryListingMedia(this.selectedListing.id, media.id)
      );
      const updated = this.integrateMediaList(this.selectedListing, response.data.media ?? []);
      this.selectedListing = updated;
      this.updateListingCollection(updated);
    } catch (error) {
      console.error('Failed to set primary media', error);
      this.mediaError = 'Failed to update primary image.';
    }
  }

  openPreview(): void {
    if (!this.selectedListing?.previewToken) {
      return;
    }
    const token = this.selectedListing.previewToken;
    window.open(`/preview/listings/${token}`, '_blank', 'noopener');
  }

  formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    const precision = index === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[index]}`;
  }

  mediaLabel(media: ListingMedia): string {
    if (media.title) {
      return media.title;
    }
    const original = typeof media.metadata?.['originalFileName'] === 'string'
      ? (media.metadata['originalFileName'] as string)
      : media.fileName ?? '';
    return original || `${media.mediaType}`;
  }

  mediaPreviewUrl(media: ListingMedia): string {
    return (media.previewUrl ?? media.url) as string;
  }

  private resolveMediaType(file: File): 'image' | 'document' | null {
    const type = (file.type || '').toLowerCase();
    if (type.startsWith('image/')) {
      return 'image';
    }
    const documentMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
    if (documentMimes.includes(type)) {
      return 'document';
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return 'image';
    }
    if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt'].includes(ext)) {
      return 'document';
    }
    return null;
  }

  private enhanceListing(listing: Listing): Listing {
    const media = this.sortMedia(listing.media ?? []);
    const metrics = listing.metrics ?? {
      viewCount: 0,
      contactCount: 0,
      lastViewedAt: null,
      lastContactAt: null
    };
    return {
      ...listing,
      attributes: listing.attributes ?? {},
      media,
      metrics: {
        viewCount: metrics.viewCount ?? 0,
        contactCount: metrics.contactCount ?? 0,
        lastViewedAt: metrics.lastViewedAt ?? null,
        lastContactAt: metrics.lastContactAt ?? null
      }
    };
  }

  private sortMedia(assets: ListingMedia[]): ListingMedia[] {
    return [...assets].sort((a, b) => {
      if (a.mediaType !== b.mediaType) {
        if (a.mediaType === 'image') {
          return -1;
        }
        if (b.mediaType === 'image') {
          return 1;
        }
      }
      if (a.isPrimary !== b.isPrimary) {
        return a.isPrimary ? -1 : 1;
      }
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  private integrateMedia(listing: Listing, media: ListingMedia): Listing {
    const existing = listing.media ?? [];
    const filtered = existing
      .filter(item => item.id !== media.id)
      .map(item =>
        media.mediaType === 'image' && media.isPrimary && item.mediaType === 'image'
          ? { ...item, isPrimary: false }
          : item
      );
    const updated = [...filtered, media];
    return { ...listing, media: this.sortMedia(updated) };
  }

  private integrateMediaList(listing: Listing, mediaList: ListingMedia[]): Listing {
    return { ...listing, media: this.sortMedia(mediaList ?? []) };
  }

  private updateListingCollection(updated: Listing): void {
    this.listings = this.listings.map(item => (item.id === updated.id ? updated : item));
  }

  private toTitleCase(value: string): string {
    if (!value) {
      return '';
    }
    return value
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .map(part => (part ? part[0].toUpperCase() + part.slice(1) : ''))
      .join(' ')
      .trim();
  }

  async deleteListing(listing: Listing): Promise<void> {
    if (!confirm(`Delete listing "${listing.title}"?`)) {
      return;
    }
    try {
      await firstValueFrom(this.api.deleteListing(listing.id));
      await this.loadListings();
    } catch (error) {
      console.error('Failed to delete listing', error);
      this.error = 'Failed to delete listing.';
    }
  }

  async loadAvailability(listingId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getAvailability(listingId));
      this.availability = response.data.slots ?? [];
    } catch (error) {
      console.warn('Failed to load availability', error);
      this.availability = [];
    }
  }

  async addAvailability(): Promise<void> {
    if (!this.selectedListing || this.availabilityForm.invalid) {
      this.availabilityForm.markAllAsTouched();
      return;
    }
    const slot: AvailabilitySlotRequest = {
      dayOfWeek: this.availabilityForm.value.dayOfWeek ?? 0,
      startMinute: this.availabilityForm.value.startMinute ?? 0,
      endMinute: this.availabilityForm.value.endMinute ?? 0
    };
    const next = [...this.availability, {
      id: crypto.randomUUID(),
      listingId: this.selectedListing.id,
      dayOfWeek: slot.dayOfWeek,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
    await this.saveAvailability(next.map(toSlotRequest));
    this.availabilityForm.reset({
      dayOfWeek: 0,
      startMinute: 540,
      endMinute: 1020
    });
  }

  async removeAvailability(slot: AvailabilitySlot): Promise<void> {
    if (!this.selectedListing) {
      return;
    }
    const next = this.availability.filter(s => s !== slot);
    await this.saveAvailability(next.map(toSlotRequest));
  }

  private async saveAvailability(slots: AvailabilitySlotRequest[]): Promise<void> {
    if (!this.selectedListing) {
      return;
    }
    try {
      await firstValueFrom(this.api.setAvailability(this.selectedListing.id, slots));
      await this.loadAvailability(this.selectedListing.id);
    } catch (error) {
      console.error('Failed to save availability', error);
      this.error = 'Failed to save availability.';
    }
  }

  async loadServiceAreas(listingId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getServiceAreas(listingId));
      this.serviceAreas = response.data.areas ?? [];
    } catch (error) {
      console.warn('Failed to load service areas', error);
      this.serviceAreas = [];
    }
  }

  async addArea(): Promise<void> {
    if (!this.selectedListing || this.areaForm.invalid) {
      this.areaForm.markAllAsTouched();
      return;
    }
    const areas = [
      ...this.serviceAreas,
      {
        id: crypto.randomUUID(),
        listingId: this.selectedListing.id,
        region: this.areaForm.value.region ?? '',
        countryCode: emptyToNull(this.areaForm.value.countryCode),
        latitude: toNumberOrUndefined(this.areaForm.value.latitude),
        longitude: toNumberOrUndefined(this.areaForm.value.longitude),
        notes: emptyToNull(this.areaForm.value.notes),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    await this.saveAreas(areas.map(toAreaRequest));
    this.areaForm.reset({ region: '', countryCode: '', latitude: null, longitude: null, notes: '' });
  }

  async removeArea(area: ServiceArea): Promise<void> {
    if (!this.selectedListing) {
      return;
    }
    const next = this.serviceAreas.filter(a => a !== area);
    await this.saveAreas(next.map(toAreaRequest));
  }

  private async saveAreas(areas: ServiceAreaRequest[]): Promise<void> {
    if (!this.selectedListing) {
      return;
    }
    try {
      await firstValueFrom(this.api.setServiceAreas(this.selectedListing.id, areas));
      await this.loadServiceAreas(this.selectedListing.id);
    } catch (error) {
      console.error('Failed to save service areas', error);
      this.error = 'Failed to save service areas.';
    }
  }

  async recordResponse(): Promise<void> {
    if (this.responseForm.invalid) {
      this.responseForm.markAllAsTouched();
      return;
    }
    this.recording = true;
    this.error = null;
    try {
      const elapsedRaw = Number(this.responseForm.value.elapsedMinutes ?? 0);
      const elapsedMinutes = Number.isFinite(elapsedRaw) ? Math.max(0, elapsedRaw) : 0;
      const jobCompleted = this.responseForm.value.jobCompleted === true;
      await firstValueFrom(this.api.recordResponseEvent(elapsedMinutes, jobCompleted));
      await this.loadAnalytics();
      this.responseForm.reset({ elapsedMinutes: 0, jobCompleted: false });
    } catch (error) {
      console.error('Failed to record response event', error);
      if (this.isForbiddenError(error)) {
        this.providerAccessBlocked = true;
        this.error = 'Provider access is not yet enabled. Complete onboarding and await approval.';
      } else {
        this.error = 'Failed to record response event.';
      }
    } finally {
      this.recording = false;
    }
  }

  private async loadAnalytics(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getAnalytics());
      const analytics = response.data?.analytics;
      if (analytics) {
        this.analytics = analytics;
      } else {
        const activeCount = this.listings.filter(listing => listing.status === 'active').length;
        this.analytics = {
          totalListings: this.listings.length,
          activeListings: activeCount,
          averageResponseMinutes: 0,
          totalResponses: 0,
          jobsCompleted: 0
        };
      }
      this.providerAccessBlocked = false;
    } catch (error) {
      if (this.isForbiddenError(error)) {
        this.providerAccessBlocked = true;
      } else {
        console.warn('Failed to load analytics', error);
      }
      this.analytics = null;
    }
  }

  private isForbiddenError(error: unknown): error is HttpErrorResponse {
    return error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
  }

  formatMinutes(minutes: number): string {
    if (!Number.isFinite(minutes)) {
      return '00:00';
    }
    const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
    const hours = Math.floor(clamped / 60)
      .toString()
      .padStart(2, '0');
    const mins = (clamped % 60).toString().padStart(2, '0');
    return `${hours}:${mins}`;
  }
}

function emptyToNull(value: string | number | null | undefined): string | null | undefined {
  if (value == null) {
    return undefined;
  }
  const str = `${value}`.trim();
  return str.length === 0 ? undefined : str;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toStringArray(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map(item => `${item}`.trim())
      .filter(item => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }
  return [];
}

function toSlotRequest(slot: AvailabilitySlot): AvailabilitySlotRequest {
  return {
    dayOfWeek: slot.dayOfWeek,
    startMinute: slot.startMinute,
    endMinute: slot.endMinute
  };
}

function toAreaRequest(area: ServiceArea): ServiceAreaRequest {
  return {
    region: area.region,
    countryCode: area.countryCode ?? undefined,
    latitude: area.latitude ?? undefined,
    longitude: area.longitude ?? undefined,
    notes: area.notes ?? undefined
  };
}
