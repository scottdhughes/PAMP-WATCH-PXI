import type { PXIResponse } from './types';

const API_BASE = process.env.NEXT_PUBLIC_PXI_API_BASE ?? 'http://localhost:8787';

export const fetchPxi = async (): Promise<PXIResponse> => {
  const response = await fetch(`${API_BASE}/v1/pxi/latest`, { next: { revalidate: 60 } });
  if (!response.ok) {
    throw new Error('Failed to load PXI feed');
  }
  return (await response.json()) as PXIResponse;
};
