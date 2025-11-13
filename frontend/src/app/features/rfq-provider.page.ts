import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RfqApiService, QuoteSubmission } from '../core/services/rfq-api.service';
import { RfqRequest, RfqQuote } from '../models/rfq';

@Component({
  selector: 'app-rfq-provider-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './rfq-provider.page.html',
  styleUrls: ['./rfq-provider.page.css']
})
export class RfqProviderPage implements OnInit {
  private readonly api = inject(RfqApiService);
  private readonly fb = inject(FormBuilder);

  requests: RfqRequest[] = [];
  selected: RfqRequest | null = null;
  selectedQuote: RfqQuote | null = null;
  loading = true;
  saving = false;
  error: string | null = null;

  quoteForm: FormGroup = this.fb.group({
    amount: [0, [Validators.required, Validators.min(0)]],
    currency: ['USD', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    summary: [''],
    expiresAt: [''],
    submit: [true]
  });

  messageForm: FormGroup = this.fb.group({
    body: ['', Validators.required]
  });

  async ngOnInit(): Promise<void> {
    await this.loadRequests();
  }

  async loadRequests(selectedId?: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const response = await firstValueFrom(this.api.listProviderRequests());
      this.requests = response.data.requests ?? [];
      if (selectedId) {
        await this.selectRequestById(selectedId);
      } else if (!this.selected && this.requests.length) {
        await this.selectRequest(this.requests[0]);
      }
    } catch (error) {
      console.error('Failed to load provider RFQs', error);
      this.error = 'Unable to load invitations.';
    } finally {
      this.loading = false;
    }
  }

  async selectRequest(request: RfqRequest): Promise<void> {
    await this.selectRequestById(request.id);
  }

  private async selectRequestById(requestId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getProviderRequest(requestId));
      this.selected = response.data.request ?? null;
      this.selectedQuote = this.selected?.quotes.find(quote => quote.providerUuid === this.getProviderId()) ?? null;
      this.populateQuoteForm();
    } catch (error) {
      console.error('Failed to fetch provider request', error);
      this.error = 'Unable to open request.';
    }
  }

  private populateQuoteForm(): void {
    if (!this.selectedQuote) {
      this.quoteForm.reset({
        amount: 0,
        currency: 'USD',
        summary: '',
        expiresAt: '',
        submit: true
      });
      return;
    }
    this.quoteForm.reset({
      amount: this.selectedQuote.amountCents / 100,
      currency: this.selectedQuote.currency ?? 'USD',
      summary: this.selectedQuote.summary ?? '',
      expiresAt: this.selectedQuote.expiresAt ?? '',
      submit: this.selectedQuote.status !== 'draft'
    });
  }

  async saveQuote(): Promise<void> {
    if (!this.selectedQuote || this.quoteForm.invalid) {
      this.quoteForm.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      const value = this.quoteForm.value;
      const payload: QuoteSubmission = {
        amountCents: Math.round((value.amount ?? 0) * 100),
        currency: (value.currency ?? 'USD').toUpperCase(),
        summary: optional(value.summary),
        expiresAt: optional(value.expiresAt),
        submit: value.submit ?? true
      };
      await firstValueFrom(this.api.updateQuote(this.selectedQuote.id, payload));
      await this.loadRequests(this.selected?.id);
    } catch (error) {
      console.error('Failed to update quote', error);
      this.error = 'Unable to update quote.';
    } finally {
      this.saving = false;
    }
  }

  async sendMessage(): Promise<void> {
    if (!this.selected || this.messageForm.invalid) {
      this.messageForm.markAllAsTouched();
      return;
    }
    try {
      await firstValueFrom(
        this.api.addProviderMessage(this.selected.id, {
          body: this.messageForm.value.body ?? '',
          quoteId: this.selectedQuote?.id
        })
      );
      this.messageForm.reset({ body: '' });
      await this.loadRequests(this.selected.id);
    } catch (error) {
      console.error('Failed to post message', error);
      this.error = 'Unable to send message.';
    }
  }

  formatAmount(cents: number, currency: string): string {
    return `${currency} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }

  private getProviderId(): string | null {
    if (!this.selected || !this.selected.quotes.length) {
      return null;
    }
    return this.selected.quotes[0].providerUuid;
  }
}

function optional(value: string | null | undefined): string | null | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}
