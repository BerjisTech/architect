import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RfqApiService, CreateRfqRequest, QuoteSubmission } from '../core/services/rfq-api.service';
import { RfqRequest, RfqQuote, RfqMessage } from '../models/rfq';

@Component({
  selector: 'app-rfq-requests-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './rfq-requests.page.html',
  styleUrls: ['./rfq-requests.page.css']
})
export class RfqRequestsPage implements OnInit {
  private readonly api = inject(RfqApiService);
  private readonly fb = inject(FormBuilder);

  createForm = this.fb.group({
    title: ['', Validators.required],
    description: [''],
    category: ['', Validators.required],
    budget: [0, [Validators.min(0)]],
    currency: ['USD', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    desiredStart: [''],
    deadline: [''],
    invites: this.fb.array<FormGroup>([])
  });

  messageForm = this.fb.group({
    body: ['', Validators.required],
    quoteId: ['']
  });

  requests: RfqRequest[] = [];
  selected: RfqRequest | null = null;
  loading = true;
  saving = false;
  postingMessage = false;
  error: string | null = null;

  ngOnInit(): void {
    this.addInvite();
    this.loadRequests();
  }

  get inviteControls(): FormArray<FormGroup> {
    return this.createForm.get('invites') as FormArray<FormGroup>;
  }

  addInvite(): void {
    this.inviteControls.push(
      this.fb.group({
        providerUuid: [''],
        listingId: ['']
      })
    );
  }

  removeInvite(index: number): void {
    if (this.inviteControls.length <= 1) {
      return;
    }
    this.inviteControls.removeAt(index);
  }

  async loadRequests(selectedId?: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const response = await firstValueFrom(this.api.listRequests());
      this.requests = response.data.requests ?? [];
      if (selectedId) {
        this.selected = this.requests.find(request => request.id === selectedId) ?? null;
      } else if (!this.selected && this.requests.length) {
        this.selectRequest(this.requests[0]);
      } else if (this.selected) {
        const updated = this.requests.find(request => request.id === this.selected?.id);
        this.selected = updated ?? null;
      }
    } catch (error) {
      console.error('Failed to load RFQ requests', error);
      this.error = 'Unable to load requests.';
    } finally {
      this.loading = false;
    }
  }

  async selectRequest(request: RfqRequest): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getRequest(request.id));
      this.selected = response.data.request ?? request;
      this.messageForm.reset({ body: '', quoteId: '' });
    } catch (error) {
      console.error('Failed to refresh request', error);
      this.selected = request;
    }
  }

  async submitRequest(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      const value = this.createForm.value;
      const payload: CreateRfqRequest = {
        title: value.title ?? '',
        description: optional(value.description),
        category: value.category ?? '',
        budgetCents: Math.round((value.budget ?? 0) * 100),
        currency: (value.currency ?? 'USD').toUpperCase(),
        desiredStartDate: optional(value.desiredStart),
        deadlineAt: optional(value.deadline),
        invites: []
      };
      for (const invite of this.inviteControls.value) {
        const providerUuid = (invite.providerUuid ?? '').trim();
        if (!providerUuid) {
          continue;
        }
        payload.invites.push({
          providerUuid,
          listingId: optional(invite.listingId)
        });
      }
      const response = await firstValueFrom(this.api.createRequest(payload));
      const created = response.data.request;
      this.requests = [created, ...this.requests];
      this.selectRequest(created);
      this.createForm.reset({
        title: '',
        description: '',
        category: '',
        budget: 0,
        currency: 'USD',
        desiredStart: '',
        deadline: ''
      });
      this.inviteControls.clear();
      this.addInvite();
    } catch (error) {
      console.error('Failed to create RFQ', error);
      this.error = 'Failed to create request.';
    } finally {
      this.saving = false;
    }
  }

  async sendMessage(): Promise<void> {
    if (!this.selected || this.messageForm.invalid) {
      this.messageForm.markAllAsTouched();
      return;
    }
    this.postingMessage = true;
    try {
      const value = this.messageForm.value;
      const quoteId = (value.quoteId ?? '').trim() || undefined;
      await firstValueFrom(
        this.api.addMessage(this.selected.id, { body: value.body ?? '', quoteId, role: 'requester' })
      );
      await this.loadRequests(this.selected.id);
      this.messageForm.reset({ body: '', quoteId: '' });
    } catch (error) {
      console.error('Failed to post message', error);
      this.error = 'Failed to send message.';
    } finally {
      this.postingMessage = false;
    }
  }

  async acceptQuote(quote: RfqQuote): Promise<void> {
    await this.updateQuoteStatus(async () => {
      const response = await firstValueFrom(this.api.acceptQuote(quote.id));
      return response.data.request;
    });
  }

  async rejectQuote(quote: RfqQuote): Promise<void> {
    await this.updateQuoteStatus(async () => {
      const response = await firstValueFrom(this.api.rejectQuote(quote.id));
      return response.data.request;
    });
  }

  async cancelSelected(): Promise<void> {
    if (!this.selected) {
      return;
    }
    await this.updateQuoteStatus(async () => {
      const response = await firstValueFrom(this.api.cancelRequest(this.selected!.id));
      return response.data.request;
    });
  }

  async closeSelected(): Promise<void> {
    if (!this.selected) {
      return;
    }
    await this.updateQuoteStatus(async () => {
      const response = await firstValueFrom(this.api.closeRequest(this.selected!.id));
      return response.data.request;
    });
  }

  statusBadge(status: string): string {
    switch ((status ?? '').toLowerCase()) {
      case 'accepted':
        return 'badge badge--success';
      case 'rejected':
      case 'expired':
        return 'badge badge--danger';
      case 'submitted':
        return 'badge badge--info';
      default:
        return 'badge';
    }
  }

  formatAmount(quote: RfqQuote): string {
    return `${quote.currency} ${(quote.amountCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }

  private async updateQuoteStatus(update: () => Promise<RfqRequest | undefined>): Promise<void> {
    if (!this.selected) {
      return;
    }
    this.saving = true;
    try {
      const updated = await update();
      if (updated) {
        this.selected = updated;
        const idx = this.requests.findIndex(req => req.id === updated.id);
        if (idx >= 0) {
          this.requests[idx] = updated;
        }
      }
    } catch (error) {
      console.error('Failed to update quote status', error);
      this.error = 'Unable to update quote.';
    } finally {
      this.saving = false;
    }
  }

  quoteMetrics(quote: RfqQuote): string {
    const chunks: string[] = [`Version ${quote.version}`];
    if (quote.expiresAt) {
      chunks.push(`Expires ${new Date(quote.expiresAt).toLocaleString()}`);
    }
    if (quote.submittedAt) {
      chunks.push(`Submitted ${new Date(quote.submittedAt).toLocaleString()}`);
    }
    return chunks.join(' • ');
  }

  isOwnMessage(message: RfqMessage): boolean {
    if (!this.selected) {
      return false;
    }
    return message.authorRole === 'requester';
  }
}

function optional(value: string | null | undefined): string | null | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}
