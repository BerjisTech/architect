import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { ProviderApiService } from '../core/services/provider-api.service';
import { ProviderSearchResult, ListingMedia } from '../models/providers';

@Component({
  selector: 'app-listing-preview-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './listing-preview.page.html',
  styleUrls: ['./listing-preview.page.css']
})
export class ListingPreviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ProviderApiService);
  private readonly sanitizer = inject(DomSanitizer);

  loading = true;
  error: string | null = null;
  preview: ProviderSearchResult | null = null;
  descriptionHtml: SafeHtml | null = null;

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!token) {
      this.error = 'Invalid preview link.';
      this.loading = false;
      return;
    }
    try {
      const response = await firstValueFrom(this.api.getListingPreview(token));
      this.preview = response.data.listing ?? null;
      if (!this.preview) {
        this.error = 'Listing not found or no longer available.';
      } else {
        const description = this.preview.listing.description ?? '';
        this.descriptionHtml = this.sanitizer.bypassSecurityTrustHtml(description);
        try {
          await firstValueFrom(this.api.recordListingView(this.preview.listing.id));
        } catch {
          // Non-fatal analytics failure.
        }
      }
    } catch (error) {
      console.error('Failed to load preview', error);
      this.error = 'Unable to load preview at this time.';
    } finally {
      this.loading = false;
    }
  }

  heroImage(): ListingMedia | null {
    const media = this.preview?.listing.media ?? [];
    const images = media.filter(item => item.mediaType === 'image');
    if (!images.length) {
      return null;
    }
    const primary = images.find(item => item.isPrimary);
    return primary ?? images[0];
  }

  galleryImages(): ListingMedia[] {
    const hero = this.heroImage();
    const media = this.preview?.listing.media ?? [];
    return media.filter(item => item.mediaType === 'image' && (!hero || item.id !== hero.id));
  }

  documents(): ListingMedia[] {
    return (this.preview?.listing.media ?? []).filter(item => item.mediaType === 'document');
  }

  formatPricingModel(model: string | null | undefined): string {
    const value = (model ?? 'fixed').replace(/[_-]+/g, ' ').trim();
    return value.replace(/\b\w/g, char => char.toUpperCase());
  }

  async recordContact(): Promise<void> {
    if (!this.preview) {
      return;
    }
    try {
      await firstValueFrom(this.api.recordListingContact(this.preview.listing.id));
    } catch {
      // Ignored
    }
  }
}
