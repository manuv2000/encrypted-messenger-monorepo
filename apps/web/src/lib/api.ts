export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiOptions  = {
  method?: 'GET' | 'POST';
  token?: string;
  body?: unknown;
};

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
  });

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  let response: Response;

  try {
    response = await fetch(`/api${path}`, {
  method: options.method ?? 'GET',
  headers,
  cache: 'no-store',
  body:
    options.body === undefined
      ? undefined
      : JSON.stringify(options.body),
  signal: AbortSignal.timeout(15_000),
});
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('The server took too long to respond. Please try again.');
    }

    throw new Error('Cannot reach the server. Check that the backend is running.');
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    let message = `Request failed (${response.status})`;

    if (
      payload !== null &&
      typeof payload === 'object' &&
      'message' in payload
    ) {
      const value = payload.message;

      if (typeof value === 'string') {
        message = value;
      } else if (Array.isArray(value)) {
        const messages = value.filter(
          (item): item is string => typeof item === 'string',
        );

        if (messages.length > 0) {
          message = messages.join(' ');
        }
      }
    }

    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}