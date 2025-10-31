import { ProxyAgent } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Custom fetch wrapper with proxy support
 *
 * Supports HTTP/HTTPS and SOCKS5 proxies with basic authentication via environment variables.
 *
 * Environment variables (in order of precedence):
 * - SOCKS_PROXY or SOCKS5_PROXY: socks5://[username:password@]host:port
 * - HTTP_PROXY or HTTPS_PROXY: http://[username:password@]host:port
 *
 * @param input - The URL or Request object
 * @param init - Optional fetch options
 * @returns Promise<Response>
 */
export const fetch = async (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => {
  // Check for SOCKS proxy first
  const socksProxyUrl = process.env.SOCKS_PROXY || process.env.SOCKS5_PROXY;
  if (socksProxyUrl) {
    const dispatcher = new SocksProxyAgent(socksProxyUrl);

    const requestInit = {
      ...init,
      dispatcher
    } as RequestInit;

    return globalThis.fetch(input, requestInit);
  }

  // Check for HTTP/HTTPS proxy
  const httpProxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (httpProxyUrl) {
    const dispatcher = new ProxyAgent(httpProxyUrl);

    const requestInit = {
      ...init,
      dispatcher
    } as RequestInit;

    return globalThis.fetch(input, requestInit);
  }

  // No proxy configured, use regular fetch
  return globalThis.fetch(input, init);
};
