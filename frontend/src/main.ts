import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, Routes } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { HomePage } from './app/pages/home.page';
import { ProjectBriefPage } from './app/pages/project-brief.page';
import { SiteAssessmentPage } from './app/pages/site-assessment.page';
import { MatchingPage } from './app/pages/matching.page';
import { ConsultationPage } from './app/pages/consultation.page';
import { ChecklistPage } from './app/pages/checklist.page';
import { DesignStudioPage } from './app/pages/design-studio.page';
import { PlansPage } from './app/pages/plans.page';
import { CORE_AUTH_API_BASE, createAuthGuard } from '@berjis/angular-auth';
import { environment } from './environments/environment';

const authGuard = createAuthGuard({
  ensureOptions: { maxAgeMs: 1500 }
});

const routes: Routes = [
  { path: '', component: HomePage, title: 'Architect - Home' },
  { path: 'project-brief', component: ProjectBriefPage, title: 'Project Brief' },
  { path: 'site-assessment', component: SiteAssessmentPage, title: 'Site Assessment' },
  { path: 'matching', component: MatchingPage, title: 'Professional Matching' },
  { path: 'consultation', component: ConsultationPage, title: 'Consultation' },
  { path: 'regulatory-checklist', component: ChecklistPage, title: 'Regulatory Checklist' },
  { path: 'plans', component: PlansPage, canActivate: [authGuard], title: 'Plans' },
  { path: 'studio', component: DesignStudioPage, canActivate: [authGuard], title: 'Design Studio' },
];

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideRouter(routes),
    { provide: CORE_AUTH_API_BASE, useValue: environment.apiBase }
  ]
}).catch(err => console.error(err));
