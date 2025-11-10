import { Injectable } from '@angular/core';
import { FloorplanRecord } from '../../models/floorplan.model';

@Injectable({ providedIn: 'root' })
export class StudioService {
  async create(name: string, data: unknown, ownerUserId?: string): Promise<string> {
    const payload = await this.request<{ id: string }>(
      '/svc/v1/floorplans',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, data, ownerUserId })
      },
      'creating plan'
    );
    return payload.id;
  }

  async update(id: string, patch: { name?: string; data?: unknown }): Promise<void> {
    await this.request<void>(
      `/svc/v1/floorplans/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch)
      },
      'updating plan'
    );
  }

  async get(id: string): Promise<FloorplanRecord> {
    return await this.request<FloorplanRecord>(`/svc/v1/floorplans/${id}`, { credentials: 'include' }, 'loading plan');
  }

  async list(ownerUserId?: string): Promise<FloorplanRecord[]> {
    const qs = ownerUserId ? `?ownerUserId=${encodeURIComponent(ownerUserId)}` : '';
    const result = await this.request<FloorplanRecord[]>(
      `/svc/v1/floorplans${qs}`,
      { credentials: 'include' },
      'listing plans'
    );
    return Array.isArray(result) ? result : [];
  }

  private async request<T>(input: RequestInfo | URL, init: RequestInit, context: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch {
      throw new Error(`Network error while ${context}.`);
    }
    const body = await this.parseResponse(res, context) as { success?: boolean; data?: unknown; message?: string };
    if (!res.ok) {
      const message = body?.message || `Service error (${res.status}) while ${context}.`;
      throw new Error(message);
    }
    if (body?.success) {
      return body.data as T;
    }
    throw new Error(body?.message || `Unable to complete request while ${context}.`);
  }

  private async parseResponse(res: Response, context: string): Promise<unknown> {
    const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
      try {
        return await res.json();
      } catch {
        throw new Error(`Invalid JSON from service while ${context}.`);
      }
    }
    const text = await res.text();
    const snippet = text.trim().slice(0, 160);
    if (!res.ok) {
      throw new Error(snippet || `Service error (${res.status}) while ${context}.`);
    }
    throw new Error(`Unexpected response while ${context}.`);
  }
}
