import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, Routes } from '@angular/router';
import { AppComponent } from './app/app.component';
import { HomePage } from './app/pages/home.page';
import { ProjectBriefPage } from './app/pages/project-brief.page';
import { SiteAssessmentPage } from './app/pages/site-assessment.page';
import { MatchingPage } from './app/pages/matching.page';
import { ConsultationPage } from './app/pages/consultation.page';
import { ChecklistPage } from './app/pages/checklist.page';

const routes: Routes = [
  { path: '', component: HomePage, title: 'Architect – Home' },
  { path: 'project-brief', component: ProjectBriefPage, title: 'Project Brief' },
  { path: 'site-assessment', component: SiteAssessmentPage, title: 'Site Assessment' },
  { path: 'matching', component: MatchingPage, title: 'Professional Matching' },
  { path: 'consultation', component: ConsultationPage, title: 'Consultation' },
  { path: 'regulatory-checklist', component: ChecklistPage, title: 'Regulatory Checklist' },
];

bootstrapApplication(AppComponent, {
  providers: [provideRouter(routes)]
}).catch(err => console.error(err));
