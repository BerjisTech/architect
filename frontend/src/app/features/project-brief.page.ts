import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'arch-project-brief',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './project-brief.page.html'
})
export class ProjectBriefPage {
  model: any = JSON.parse(localStorage.getItem('arch.projectBrief') || '{}');
  savedAt = '';
  save(){
    localStorage.setItem('arch.projectBrief', JSON.stringify(this.model));
    this.savedAt = new Date().toLocaleTimeString();
  }
}
