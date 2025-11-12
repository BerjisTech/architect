import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ProviderApiService, ListingRequest, ServiceAreaRequest, AvailabilitySlotRequest } from '../core/services/provider-api.service';
import { Listing, AvailabilitySlot, ServiceArea, Analytics } from '../models/providers';

const CATEGORY_OPTIONS = [
  'design',
  'engineering',
  'construction',
  'consulting',
  'legal',
  'surveying',
  'materials',
  'logistics',
  'general'
];

const PRICING_MODELS = ['fixed', 'hourly', 'quote'];
const STATUSES = ['draft', 'active', 'archived'];

@Component({
  selector: 'app-provider-dashboard-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './provider-dashboard.page.html'
})
export class ProviderDashboardPage implements OnInit {
  private readonly api = inject(ProviderApiService);
  private readonly fb = inject(FormBuilder);

  listings: Listing[] = [];
  availability: AvailabilitySlot[] = [];
  serviceAreas: ServiceArea[] = [];
  analytics: Analytics | null = null;

  selectedListing: Listing | null = null;
  loading = true;
  saving = false;
  recording = false;
  error: string | null = null;
  providerAccessBlocked = false;

  readonly dayOptions = [0, 1, 2, 3, 4, 5, 6];
  readonly dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  readonly dayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  listingForm = this.fb.group({
    id: [''],
    title: ['', Validators.required],
    summary: [''],
    description: [''],
    category: ['general', Validators.required],
    pricingModel: ['fixed', Validators.required],
    basePrice: [0, [Validators.required, Validators.min(0)]],
    currency: ['USD', [Validators.required, Validators.minLength(3)]],
    status: ['draft', Validators.required]
  });

  availabilityForm = this.fb.group({
    dayOfWeek: [0, [Validators.required, Validators.min(0), Validators.max(6)]],
    startMinute: [540, [Validators.required, Validators.min(0), Validators.max(1440)]],
    endMinute: [1020, [Validators.required, Validators.min(0), Validators.max(1440)]]
  });

  areaForm = this.fb.group({
    region: ['', Validators.required],
    countryCode: [''],
    notes: ['']
  });

  responseForm = this.fb.group({
    elapsedMinutes: [0, [Validators.required, Validators.min(0)]],
    jobCompleted: [false]
  });

  get categories(): string[] {
    return CATEGORY_OPTIONS;
  }

  get pricingModels(): string[] {
    return PRICING_MODELS;
  }

  get statuses(): string[] {
    return STATUSES;
  }

  async ngOnInit(): Promise<void> {
    await this.loadListings();
  }

  private async loadListings(): Promise<void> {
    try {
      this.loading = true;
      this.error = null;
      const response = await firstValueFrom(this.api.listMyListings());
      this.providerAccessBlocked = false;
      this.listings = response.data.listings ?? [];
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
    this.selectedListing = listing;
    if (!listing) {
      this.listingForm.reset({
        id: '',
        title: '',
        summary: '',
        description: '',
        category: 'general',
        pricingModel: 'fixed',
        basePrice: 0,
        currency: 'USD',
        status: 'draft'
      });
      this.availability = [];
      this.serviceAreas = [];
      return;
    }
    this.listingForm.reset({
      id: listing.id,
      title: listing.title,
      summary: listing.summary ?? '',
      description: listing.description ?? '',
      category: listing.category ?? 'general',
      pricingModel: listing.pricingModel ?? 'fixed',
      basePrice: listing.basePriceCents / 100,
      currency: listing.currency ?? 'USD',
      status: listing.status ?? 'draft'
    });
    this.loadAvailability(listing.id);
    this.loadServiceAreas(listing.id);
  }

  async saveListing(): Promise<void> {
    if (this.listingForm.invalid) {
      this.listingForm.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      const value = this.listingForm.value;
      const payload: ListingRequest = {
        title: value.title ?? '',
        summary: emptyToNull(value.summary),
        description: emptyToNull(value.description),
        category: value.category ?? 'general',
        pricingModel: value.pricingModel ?? 'fixed',
        basePriceCents: Math.round((value.basePrice ?? 0) * 100),
        currency: (value.currency ?? 'USD').toUpperCase(),
        status: value.status ?? 'draft'
      };
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
        notes: emptyToNull(this.areaForm.value.notes),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    await this.saveAreas(areas.map(toAreaRequest));
    this.areaForm.reset({ region: '', countryCode: '', notes: '' });
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
    notes: area.notes ?? undefined
  };
}
