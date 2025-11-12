import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, firstValueFrom } from 'rxjs';
import { CoreAuthService, CoreAuthSession } from '@berjis/angular-auth';
import { ProfileApiService } from '../core/services/profile-api.service';
import {
  Profile,
  PortfolioItem,
  Certification,
  Review,
  ReviewSummary
} from '../models/profile';

@Component({
  selector: 'app-profile-view-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './profile-view.page.html'
})
export class ProfileViewPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ProfileApiService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(CoreAuthService);
  private sub?: Subscription;

  loading = true;
  profile: Profile | null = null;
  portfolio: PortfolioItem[] = [];
  certifications: Certification[] = [];
  reviews: Review[] = [];
  summary: ReviewSummary | null = null;
  lastError: string | null = null;

  currentUser: CoreAuthSession | null = null;
  viewerUuid: string | null = null;
  targetUuid: string | null = null;

  reviewForm = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    title: [''],
    comment: [''],
    isPublic: [true]
  });

  async ngOnInit(): Promise<void> {
    this.currentUser = await this.auth.ensureAuth();
    this.viewerUuid = this.currentUser?.uuid ?? null;
    this.sub = this.route.paramMap.subscribe(async params => {
      this.targetUuid = params.get('userUuid');
      await this.loadAll();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private async loadAll(): Promise<void> {
    if (!this.targetUuid) {
      this.lastError = 'Profile not found.';
      return;
    }
    try {
      this.loading = true;
      this.lastError = null;
      const [profileResp, portfolioResp, certResp, reviewResp] = await Promise.all([
        firstValueFrom(this.api.getPublicProfile(this.targetUuid)),
        firstValueFrom(this.api.listPublicPortfolio(this.targetUuid)),
        firstValueFrom(this.api.listPublicCertifications(this.targetUuid)),
        firstValueFrom(this.api.listPublicReviews(this.targetUuid))
      ]);
      this.profile = profileResp.data.profile;
      this.portfolio = portfolioResp.data.items ?? [];
      this.certifications = certResp.data.items ?? [];
      this.reviews = reviewResp.data.items ?? [];
      this.summary = this.profile.reviewSummary ?? { average: 0, count: 0 };
    } catch (error) {
      console.error('Failed to load profile view', error);
      this.lastError = 'Unable to load profile.';
    } finally {
      this.loading = false;
    }
  }

  async submitReview(): Promise<void> {
    if (!this.profile || !this.targetUuid || !this.viewerUuid) {
      return;
    }
    if (this.profile.userUuid === this.viewerUuid) {
      this.lastError = 'You cannot review your own profile.';
      return;
    }
    if (this.reviewForm.invalid) {
      this.reviewForm.markAllAsTouched();
      return;
    }
    this.lastError = null;
    const value = this.reviewForm.value;
    try {
      await firstValueFrom(
        this.api.createReview(this.targetUuid, {
          rating: value.rating ?? 5,
          title: emptyToNull(value.title),
          comment: emptyToNull(value.comment),
          isPublic: value.isPublic ?? true
        })
      );
      this.reviewForm.reset({ rating: 5, isPublic: true });
      await this.loadAll();
    } catch (error) {
      console.error('Failed to submit review', error);
      this.lastError = 'Failed to submit review.';
    }
  }

  async deleteReview(review: Review): Promise<void> {
    if (!this.targetUuid) {
      return;
    }
    if (!this.canDeleteReview(review)) {
      return;
    }
    if (!confirm('Delete this review?')) {
      return;
    }
    try {
      await firstValueFrom(this.api.deleteReview(this.targetUuid, review.id));
      await this.loadAll();
    } catch (error) {
      console.error('Failed to delete review', error);
      this.lastError = 'Failed to delete review.';
    }
  }

  canReview(): boolean {
    return !!this.viewerUuid && !!this.profile && this.viewerUuid !== this.profile.userUuid;
  }

  canDeleteReview(review: Review): boolean {
    if (!this.viewerUuid || !this.currentUser) {
      return false;
    }
    if (review.reviewerUuid === this.viewerUuid) {
      return true;
    }
    const platformRoles = this.currentUser.platformRoles ?? [];
    const appRoles = this.currentUser.appRoles?.architect ?? [];
    return (
      platformRoles.includes('platform.admin') ||
      appRoles.includes('architect.admin') ||
      appRoles.includes('architect.support')
    );
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }
}

function emptyToNull(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
