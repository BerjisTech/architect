import { Routes } from '@angular/router';
import { EnsureAuthGuard } from './core/guards/auth.guard';

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home.page').then(m => m.HomePage),
    title: 'Architect - Home'
  },
  {
    path: 'project-brief',
    loadComponent: () => import('./features/project-brief.page').then(m => m.ProjectBriefPage),
    title: 'Project Brief'
  },
  {
    path: 'site-assessment',
    loadComponent: () => import('./features/site-assessment.page').then(m => m.SiteAssessmentPage),
    title: 'Site Assessment'
  },
  {
    path: 'matching',
    loadComponent: () => import('./features/matching.page').then(m => m.MatchingPage),
    title: 'Professional Matching'
  },
  {
    path: 'consultation',
    loadComponent: () => import('./features/consultation.page').then(m => m.ConsultationPage),
    title: 'Consultation'
  },
  {
    path: 'regulatory-checklist',
    loadComponent: () => import('./features/checklist.page').then(m => m.ChecklistPage),
    title: 'Regulatory Checklist'
  },
  {
    path: 'plans',
    canActivate: [EnsureAuthGuard],
    loadComponent: () => import('./features/plans.page').then(m => m.PlansPage),
    title: 'Plans'
  },
  {
    path: 'profile',
    canActivate: [EnsureAuthGuard],
    loadComponent: () => import('./features/profile-edit.page').then(m => m.ProfileEditPage),
    title: 'My Profile'
  },
  {
    path: 'provider/onboarding',
    canActivate: [EnsureAuthGuard],
    loadComponent: () => import('./features/provider-onboarding.page').then(m => m.ProviderOnboardingPage),
    title: 'Provider Onboarding'
  },
  {
    path: 'provider/dashboard',
    canActivate: [EnsureAuthGuard],
    loadComponent: () => import('./features/provider-dashboard.page').then(m => m.ProviderDashboardPage),
    title: 'Provider Dashboard'
  },
  {
    path: 'provider/quotes',
    canActivate: [EnsureAuthGuard],
    loadComponent: () => import('./features/rfq-provider.page').then(m => m.RfqProviderPage),
    title: 'Quote Workspace'
  },
  {
    path: 'profiles/:userUuid',
    loadComponent: () => import('./features/profile-view.page').then(m => m.ProfileViewPage),
    title: 'Profile'
  },
  {
    path: 'preview/listings/:token',
    loadComponent: () => import('./features/listing-preview.page').then(m => m.ListingPreviewPage),
    title: 'Listing Preview'
  },
  {
    path: 'rfq/requests',
    canActivate: [EnsureAuthGuard],
    loadComponent: () => import('./features/rfq-requests.page').then(m => m.RfqRequestsPage),
    title: 'Requests for Quotes'
  },
  {
    path: 'studio',
    canActivate: [EnsureAuthGuard],
    loadComponent: () => import('./features/design-studio.page').then(m => m.DesignStudioPage),
    title: 'Design Studio'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
