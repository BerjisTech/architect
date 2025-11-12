import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CoreAuthService, CoreAuthSession } from '@berjis/angular-auth';
import { ProfileApiService } from '../core/services/profile-api.service';
import { Profile, PortfolioItem, Certification } from '../models/profile';
import {
  ARCHITECT_PROVIDER_PROFILES,
  ArchitectProfileType
} from '../models/profile-types';

@Component({
  selector: 'app-profile-edit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './profile-edit.page.html'
})
export class ProfileEditPage implements OnInit {
  private readonly api = inject(ProfileApiService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(CoreAuthService);

  loading = true;
  saving = false;
  profile: Profile | null = null;
  session: CoreAuthSession | null = null;
  portfolio: PortfolioItem[] = [];
  certifications: Certification[] = [];
  lastError: string | null = null;
  lastSuccess: string | null = null;

  profileTypes = ARCHITECT_PROVIDER_PROFILES;

  profileForm = this.fb.group({
    profileType: ['', Validators.required],
    displayName: [''],
    headline: [''],
    companyName: [''],
    phone: [''],
    website: [''],
    location: [''],
    bio: [''],
    specialties: [''],
    avatarUrl: [''],
    isPublic: [true]
  });

  portfolioForm = this.fb.group({
    id: [''],
    title: ['', Validators.required],
    description: [''],
    mediaUrl: [''],
    tags: [''],
    isPublic: [true],
    position: [0]
  });

  certificationForm = this.fb.group({
    id: [''],
    name: ['', Validators.required],
    issuer: [''],
    issuedOn: [''],
    expiresOn: [''],
    credentialId: [''],
    credentialUrl: ['']
  });

  verificationStatus = '';
  verificationNotes = '';

  ngOnInit(): void {
    this.initialise();
  }

  private async initialise(): Promise<void> {
    try {
      this.loading = true;
      this.session = await this.auth.ensureAuth();
      await this.loadProfile();
      await this.loadPortfolio();
      await this.loadCertifications();
    } catch (error) {
      console.error('Failed to load profile', error);
      this.lastError = 'Failed to load profile data.';
    } finally {
      this.loading = false;
    }
  }

  private async loadProfile(): Promise<void> {
    const response = await firstValueFrom(this.api.getMyProfile());
    this.profile = response.data.profile;
    const specialties = (this.profile.specialties ?? []).join(', ');
    this.profileForm.patchValue({
      profileType: this.profile.profileType,
      displayName: this.profile.displayName ?? '',
      headline: this.profile.headline ?? '',
      companyName: this.profile.companyName ?? '',
      phone: this.profile.phone ?? '',
      website: this.profile.website ?? '',
      location: this.profile.location ?? '',
      bio: this.profile.bio ?? '',
      specialties,
      avatarUrl: this.profile.avatarUrl ?? '',
      isPublic: this.profile.isPublic
    });
    this.verificationStatus = this.profile.verificationStatus;
    this.verificationNotes = this.profile.verificationNotes ?? '';
  }

  private async loadPortfolio(): Promise<void> {
    const response = await firstValueFrom(this.api.listMyPortfolio());
    this.portfolio = response.data.items ?? [];
  }

  private async loadCertifications(): Promise<void> {
    const response = await firstValueFrom(this.api.listMyCertifications());
    this.certifications = response.data.items ?? [];
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.lastError = null;
    try {
      const value = this.profileForm.value;
      const specialties =
        value.specialties
          ?.split(',')
          .map(v => v.trim())
          .filter(v => v.length > 0) ?? [];
      const payload = {
        profileType: (value.profileType ?? '').trim() as ArchitectProfileType,
        displayName: emptyToNull(value.displayName),
        headline: emptyToNull(value.headline),
        companyName: emptyToNull(value.companyName),
        phone: emptyToNull(value.phone),
        website: emptyToNull(value.website),
        location: emptyToNull(value.location),
        bio: emptyToNull(value.bio),
        avatarUrl: emptyToNull(value.avatarUrl),
        specialties,
        isPublic: value.isPublic ?? true
      };
      await firstValueFrom(this.api.updateMyProfile(payload));
      await this.loadProfile();
      this.lastSuccess = 'Profile saved.';
    } catch (error) {
      console.error('Failed to save profile', error);
      this.lastError = 'Failed to save profile.';
    } finally {
      this.saving = false;
    }
  }

  startCreatePortfolio(): void {
    this.portfolioForm.reset({
      id: '',
      title: '',
      description: '',
      mediaUrl: '',
      tags: '',
      isPublic: true,
      position: this.portfolio.length
    });
  }

  editPortfolio(item: PortfolioItem): void {
    this.portfolioForm.reset({
      id: item.id,
      title: item.title,
      description: item.description ?? '',
      mediaUrl: item.mediaUrl ?? '',
      tags: (item.tags ?? []).join(', '),
      isPublic: item.isPublic,
      position: item.position
    });
  }

  async submitPortfolio(): Promise<void> {
    if (this.portfolioForm.invalid) {
      this.portfolioForm.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.lastError = null;
    try {
      const value = this.portfolioForm.value;
      const tags =
        value.tags
          ?.split(',')
          .map(v => v.trim())
          .filter(v => v.length > 0) ?? [];
      await firstValueFrom(
        this.api.savePortfolioItem({
          id: emptyToNull(value.id),
          title: (value.title ?? '').trim(),
          description: emptyToNull(value.description),
          mediaUrl: emptyToNull(value.mediaUrl),
          tags,
          isPublic: value.isPublic ?? true,
          position: Number(value.position ?? 0)
        })
      );
      await this.loadPortfolio();
      this.startCreatePortfolio();
      this.lastSuccess = 'Portfolio item saved.';
    } catch (error) {
      console.error('Failed to save portfolio item', error);
      this.lastError = 'Failed to save portfolio item.';
    } finally {
      this.saving = false;
    }
  }

  async removePortfolio(item: PortfolioItem): Promise<void> {
    if (!confirm(`Delete portfolio item "${item.title}"?`)) {
      return;
    }
    this.lastError = null;
    try {
      await firstValueFrom(this.api.deletePortfolioItem(item.id));
      await this.loadPortfolio();
      this.lastSuccess = 'Portfolio item removed.';
    } catch (error) {
      console.error('Failed to delete portfolio item', error);
      this.lastError = 'Failed to delete portfolio item.';
    }
  }

  startCreateCertification(): void {
    this.certificationForm.reset({
      id: '',
      name: '',
      issuer: '',
      issuedOn: '',
      expiresOn: '',
      credentialId: '',
      credentialUrl: ''
    });
  }

  editCertification(item: Certification): void {
    this.certificationForm.reset({
      id: item.id,
      name: item.name,
      issuer: item.issuer ?? '',
      issuedOn: (item.issuedOn ?? '').slice(0, 10),
      expiresOn: (item.expiresOn ?? '').slice(0, 10),
      credentialId: item.credentialId ?? '',
      credentialUrl: item.credentialUrl ?? ''
    });
  }

  async submitCertification(): Promise<void> {
    if (this.certificationForm.invalid) {
      this.certificationForm.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.lastError = null;
    try {
      const value = this.certificationForm.value;
      await firstValueFrom(
        this.api.saveCertification({
          id: emptyToNull(value.id),
          name: (value.name ?? '').trim(),
          issuer: emptyToNull(value.issuer),
          issuedOn: emptyToNull(value.issuedOn),
          expiresOn: emptyToNull(value.expiresOn),
          credentialId: emptyToNull(value.credentialId),
          credentialUrl: emptyToNull(value.credentialUrl)
        })
      );
      await this.loadCertifications();
      this.startCreateCertification();
      this.lastSuccess = 'Certification saved.';
    } catch (error) {
      console.error('Failed to save certification', error);
      this.lastError = 'Failed to save certification.';
    } finally {
      this.saving = false;
    }
  }

  async removeCertification(item: Certification): Promise<void> {
    if (!confirm(`Delete certification "${item.name}"?`)) {
      return;
    }
    this.lastError = null;
    try {
      await firstValueFrom(this.api.deleteCertification(item.id));
      await this.loadCertifications();
      this.lastSuccess = 'Certification removed.';
    } catch (error) {
      console.error('Failed to delete certification', error);
      this.lastError = 'Failed to delete certification.';
    }
  }

  async updateCertificationStatus(item: Certification, status: string): Promise<void> {
    if (!this.isPrivileged()) {
      return;
    }
    this.lastError = null;
    try {
      await firstValueFrom(
        this.api.updateCertificationStatus(item.userUuid, item.id, { status })
      );
      await this.loadCertifications();
      await this.loadProfile();
      this.lastSuccess = 'Certification status updated.';
    } catch (error) {
      console.error('Failed to update certification status', error);
      this.lastError = 'Failed to update certification status.';
    }
  }

  async updateVerification(status: string): Promise<void> {
    if (!this.isPrivileged() || !this.profile) {
      return;
    }
    this.lastError = null;
    try {
      await firstValueFrom(
        this.api.setVerificationStatus(this.profile.userUuid, {
          status,
          notes: this.verificationNotes || undefined
        })
      );
      await this.loadProfile();
      this.lastSuccess = 'Verification status updated.';
    } catch (error) {
      console.error('Failed to update verification', error);
      this.lastError = 'Failed to update verification.';
    }
  }

  completionEntries(): { key: string; value: boolean }[] {
    if (!this.profile) {
      return [];
    }
    return Object.entries(this.profile.completionSections || {}).map(([key, value]) => ({ key, value }));
  }

  isPrivileged(): boolean {
    if (!this.session) {
      return false;
    }
    const platformRoles = this.session.platformRoles ?? [];
    const appRoles = this.session.appRoles?.architect ?? [];
    return (
      platformRoles.includes('platform.admin') ||
      appRoles.includes('architect.admin') ||
      appRoles.includes('architect.support')
    );
  }
}

function emptyToNull(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
