import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StudioService {
  async create(name: string, data: any, ownerUserId?: string): Promise<string> {
    const res = await fetch('/svc/v1/floorplans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, data, ownerUserId })
    });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error('create failed');
    return json.data.id;
  }

  async update(id: string, patch: { name?: string; data?: any }): Promise<void> {
    const res = await fetch(`/svc/v1/floorplans/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error('update failed');
  }

  async get(id: string): Promise<any> {
    const res = await fetch(`/svc/v1/floorplans/${id}`, { credentials: 'include' });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error('not found');
    return json.data;
  }
}

