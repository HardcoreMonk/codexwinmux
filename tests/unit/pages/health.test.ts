import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../../../package.json';
import handler from '@/pages/api/health';

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const headers: Record<string, number | string | string[]> = {};

  const res = {
    setHeader: vi.fn((name: string, value: number | string | string[]) => {
      headers[name] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
      return res;
    }),
    end: vi.fn(() => res),
  } as unknown as NextApiResponse;

  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    headers,
  };
};

const createRequest = (method: string): NextApiRequest =>
  ({ method }) as NextApiRequest;

describe('/api/health', () => {
  it('returns build identity metadata with CORS headers', () => {
    const response = createResponse();

    handler(createRequest('GET'), response.res);

    expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(response.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(response.body).toMatchObject({
      app: 'codexwinmux',
      version: packageJson.version,
    });
    expect(response.body).toHaveProperty('commit');
    expect(response.body).toHaveProperty('buildTime');
  });

  it('allows OPTIONS probes from the Android launcher', () => {
    const response = createResponse();

    handler(createRequest('OPTIONS'), response.res);

    expect(response.statusCode).toBe(204);
    expect(response.res.end).toHaveBeenCalled();
  });
});
