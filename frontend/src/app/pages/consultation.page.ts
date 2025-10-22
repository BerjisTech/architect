import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'arch-consultation',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './consultation.page.html'
})
export class ConsultationPage {
  date = '';
  time = '';
  notes = '';
  message = '';
  book(){
    // TODO: POST to /svc/v1/consultations
    this.message = 'Consultation request submitted';
  }
}
