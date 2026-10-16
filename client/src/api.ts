import type { Asset, Design, DesignSettings, FeedbackRequest, GenerateRequest, StatusResponse, Upload, User } from '@asset-gen/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isJson = init.body !== undefined && !(init.body instanceof FormData);
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: isJson ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface DesignInput {
  name: string;
  prompt: string;
  settings: DesignSettings;
  uploadIds: string[];
}

export const api = {
  me: () => request<{ user: User | null }>('/api/auth/me').then((r) => r.user),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', json('POST', { email, password })).then((r) => r.user),
  register: (email: string, password: string, displayName: string) =>
    request<{ user: User }>('/api/auth/register', json('POST', { email, password, displayName })).then((r) => r.user),
  logout: () => request<{ ok: true }>('/api/auth/logout', json('POST')),

  upload: (files: { blob: Blob; name: string }[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f.blob, f.name);
    return request<{ uploads: Upload[] }>('/api/uploads', { method: 'POST', body: form }).then((r) => r.uploads);
  },

  generate: (req: GenerateRequest) => request<{ asset: Asset }>('/api/generate', json('POST', req)).then((r) => r.asset),

  status: () => request<StatusResponse>('/api/status'),
  sendFeedback: (id: string, body: FeedbackRequest) =>
    request<{ asset: Asset }>(`/api/assets/${id}/feedback`, json('POST', body)).then((r) => r.asset),

  listAssets: () => request<{ assets: Asset[] }>('/api/assets').then((r) => r.assets),
  saveAsset: (id: string, body: { name?: string; designId?: string | null; thumbnail?: string }) =>
    request<{ asset: Asset }>(`/api/assets/${id}/save`, json('POST', body)).then((r) => r.asset),
  deleteAsset: (id: string) => request<{ ok: true }>(`/api/assets/${id}`, json('DELETE')),

  listDesigns: () => request<{ designs: Design[] }>('/api/designs').then((r) => r.designs),
  getDesign: (id: string) => request<{ design: Design }>(`/api/designs/${id}`).then((r) => r.design),
  createDesign: (d: DesignInput) => request<{ design: Design }>('/api/designs', json('POST', d)).then((r) => r.design),
  updateDesign: (id: string, d: DesignInput) =>
    request<{ design: Design }>(`/api/designs/${id}`, json('PUT', d)).then((r) => r.design),
  deleteDesign: (id: string) => request<{ ok: true }>(`/api/designs/${id}`, json('DELETE')),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
