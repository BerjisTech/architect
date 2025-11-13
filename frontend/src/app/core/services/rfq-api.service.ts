import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { RfqRequest, RfqQuote, RfqMessage } from '../../models/rfq';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

type RequestListResponse = ApiResponse<{ requests: RfqRequest[] }>;
type RequestResponse = ApiResponse<{ request: RfqRequest }>;
type MessageResponse = ApiResponse<{ message: RfqMessage }>;
type QuoteResponse = ApiResponse<{ quote: RfqQuote }>;

@Injectable({ providedIn: 'root' })
export class RfqApiService {
  private readonly base = '/rfq';

  constructor(private readonly http: HttpClient) {}

  createRequest(payload: CreateRfqRequest): Observable<RequestResponse> {
    return this.http.post<RequestResponse>(`${this.base}/requests`, payload, { withCredentials: true });
  }

  listRequests(): Observable<RequestListResponse> {
    return this.http.get<RequestListResponse>(`${this.base}/requests`, { withCredentials: true });
  }

  getRequest(id: string): Observable<RequestResponse> {
    return this.http.get<RequestResponse>(`${this.base}/requests/${encodeURIComponent(id)}`, {
      withCredentials: true
    });
  }

  cancelRequest(id: string): Observable<RequestResponse> {
    return this.http.post<RequestResponse>(`${this.base}/requests/${encodeURIComponent(id)}/cancel`, {}, { withCredentials: true });
  }

  closeRequest(id: string): Observable<RequestResponse> {
    return this.http.post<RequestResponse>(`${this.base}/requests/${encodeURIComponent(id)}/close`, {}, { withCredentials: true });
  }

  addMessage(requestId: string, payload: { body: string; quoteId?: string; role?: string }): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      `${this.base}/requests/${encodeURIComponent(requestId)}/messages`,
      payload,
      { withCredentials: true }
    );
  }

  listProviderRequests(): Observable<RequestListResponse> {
    return this.http.get<RequestListResponse>(`${this.base}/provider/requests`, { withCredentials: true });
  }

  getProviderRequest(id: string): Observable<RequestResponse> {
    return this.http.get<RequestResponse>(`${this.base}/provider/requests/${encodeURIComponent(id)}`, {
      withCredentials: true
    });
  }

  updateQuote(id: string, payload: QuoteSubmission): Observable<QuoteResponse> {
    return this.http.put<QuoteResponse>(`${this.base}/provider/quotes/${encodeURIComponent(id)}`, payload, {
      withCredentials: true
    });
  }

  addProviderMessage(requestId: string, payload: { body: string; quoteId?: string }): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      `${this.base}/provider/requests/${encodeURIComponent(requestId)}/messages`,
      payload,
      { withCredentials: true }
    );
  }

  acceptQuote(id: string): Observable<RequestResponse> {
    return this.http.post<RequestResponse>(`${this.base}/quotes/${encodeURIComponent(id)}/accept`, {}, { withCredentials: true });
  }

  rejectQuote(id: string): Observable<RequestResponse> {
    return this.http.post<RequestResponse>(`${this.base}/quotes/${encodeURIComponent(id)}/reject`, {}, { withCredentials: true });
  }
}

export interface CreateRfqRequest {
  title: string;
  description?: string | null;
  category: string;
  budgetCents: number;
  currency: string;
  desiredStartDate?: string | null;
  deadlineAt?: string | null;
  invites: Array<{
    providerUuid: string;
    listingId?: string | null;
  }>;
}

export interface QuoteSubmission {
  amountCents: number;
  currency: string;
  summary?: string | null;
  expiresAt?: string | null;
  submit: boolean;
}
