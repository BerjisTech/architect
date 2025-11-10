import { Routes } from '@angular/router';
import { ensureAuthGuard } from './core/guards/auth.guard';

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
    canActivate: [ensureAuthGuard],
    loadComponent: () => import('./features/plans.page').then(m => m.PlansPage),
    title: 'Plans'
  },
  {
    path: 'studio',
    canActivate: [ensureAuthGuard],
    loadComponent: () => import('./features/design-studio.page').then(m => m.DesignStudioPage),
    title: 'Design Studio'
  },
  {
    path: '**',
    redirectTo: ''
  }
];

