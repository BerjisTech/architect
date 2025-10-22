import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'arch-consultation',
  standalone: true,
  imports: [FormsModule],
  template: `
  <h2 class="text-xl font-semibold mb-4">Consultation Booking</h2>
  <form class="grid gap-3 max-w-xl" (ngSubmit)="book()">
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Preferred Date</span>
      <input type="date" class="border rounded px-3 py-2" [(ngModel)]="date" name="date" />
    </label>
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Preferred Time</span>
      <input type="time" class="border rounded px-3 py-2" [(ngModel)]="time" name="time" />
    </label>
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Notes</span>
      <textarea class="border rounded px-3 py-2" [(ngModel)]="notes" name="notes" placeholder="Agenda, stakeholders..."></textarea>
    </label>
    <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded w-max">Book</button>
  </form>
  <p *ngIf="message" class="mt-3 text-green-700">{{message}}</p>
  `
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

