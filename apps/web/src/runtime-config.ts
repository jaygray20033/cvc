// Runtime config: prod reads window.__CVC_CONFIG__ (public/config.js); dev falls back to Vite env.
interface CvcConfig {
  apiUrl: string;
  wsUrl: string;
}

declare global {
  interface Window {
    __CVC_CONFIG__?: CvcConfig;
  }
}

const fromWindow = typeof window !== 'undefined' ? window.__CVC_CONFIG__ : undefined;

export const runtimeConfig: CvcConfig = {
  apiUrl: fromWindow?.apiUrl ?? import.meta.env.VITE_API_URL ?? '',
  wsUrl: fromWindow?.wsUrl ?? import.meta.env.VITE_WS_URL ?? '',
};
