import { ProxyAgent } from 'undici';

/**
 * Custom fetch wrapper with proxy support
 *
 * Supports HTTP proxy with basic authentication via the HTTP_PROXY or HTTPS_PROXY environment variable.
 * Format: http://username:password@proxy-host:port
 *
 * @param input - The URL or Request object
 * @param init - Optional fetch options
 * @returns Promise<Response>
 */
export const fetch = async (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => {
  const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

  if (proxyUrl) {
    // Create undici proxy agent
    const dispatcher = new ProxyAgent(proxyUrl);

    // Add dispatcher to the request options
    const requestInit = {
      ...init,
      dispatcher
    } as RequestInit;

    return globalThis.fetch(input, requestInit);
  }

  // No proxy configured, use regular fetch
  return globalThis.fetch(input, init);
};
