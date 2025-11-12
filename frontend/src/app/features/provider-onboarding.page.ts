import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CoreAuthService, CoreAuthSession } from '@berjis/angular-auth';
import { ProviderApiService } from '../core/services/provider-api.service';
import { ARCHITECT_PROVIDER_PROFILES, ArchitectProfileType } from '../models/profile-types';
import { OnboardingStatus } from '../models/providers';

@Component({
  selector: 'app-provider-onboarding-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './provider-onboarding.page.html'
})
export class ProviderOnboardingPage implements OnInit {
  private readonly api = inject(ProviderApiService);
  private readonly auth = inject(CoreAuthService);
  private readonly fb = inject(FormBuilder);

  loading = true;
  submitting = false;
  error: string | null = null;
  session: CoreAuthSession | null = null;
  status: OnboardingStatus | null = null;
  pending: OnboardingStatus[] = [];

  profileOptions = ARCHITECT_PROVIDER_PROFILES.filter(option => option.type !== 'homeowner');

  submitForm = this.fb.group({
    profileType: ['', Validators.required]
  });

  notesForm = this.fb.group({
    notes: ['']
  });

  async ngOnInit(): Promise<void> {
    await this.initialise();
  }

  private async initialise(): Promise<void> {
    try {
      this.loading = true;
      this.session = await this.auth.ensureAuth();
      await this.refreshStatus();
      if (this.isPrivileged()) {
        await this.loadPending();
      }
    } catch (error) {
      console.error('Failed to load provider onboarding status', error);
      this.error = 'Unable to load onboarding status.';
    } finally {
      this.loading = false;
    }
  }

  private async refreshStatus(): Promise<void> {
    const response = await firstValueFrom(this.api.getOnboardingStatus());
    this.status = response.data.status;
    if (this.status && this.status.profileType) {
      this.submitForm.patchValue({ profileType: this.status.profileType as ArchitectProfileType });
    }
  }

  private async loadPending(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.listPendingOnboarding());
      this.pending = response.data.requests ?? [];
    } catch (error) {
      console.warn('Failed to load pending onboarding requests', error);
    }
  }

  async submit(): Promise<void> {
    if (this.submitForm.invalid) {
      this.submitForm.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.error = null;
    try {
      const profileType = this.submitForm.value.profileType as ArchitectProfileType;
      await firstValueFrom(this.api.submitOnboarding(profileType));
      await this.refreshStatus();
    } catch (error) {
      console.error('Failed to submit onboarding', error);
      this.error = 'Failed to submit onboarding request.';
    } finally {
      this.submitting = false;
    }
  }

  async review(status: OnboardingStatus, stage: 'approved' | 'rejected' | 'in_review'): Promise<void> {
    if (!this.isPrivileged()) {
      return;
    }
    try {
      await firstValueFrom(this.api.reviewOnboarding(status.userUuid, stage, this.notesForm.value.notes ?? undefined));
      await Promise.all([this.refreshStatus(), this.loadPending()]);
      this.notesForm.reset();
    } catch (error) {
      console.error('Failed to review onboarding request', error);
      this.error = 'Failed to update onboarding request.';
    }
  }

  stageLabel(stage?: string | null): string {
    if (!stage) {
      return 'not_started';
    }
    return stage;
  }

  isPrivileged(): boolean {
    const session = this.session;
    if (!session) {
      return false;
    }
    const platform = session.platformRoles ?? [];
    const app = session.appRoles?.architect ?? [];
    return (
      platform.includes('platform.admin') ||
      app.includes('architect.admin') ||
      app.includes('architect.support')
    );
  }
}
