type CoreWindow = Window & { __CORE_API__?: unknown };
const globalWindow: CoreWindow | undefined = typeof window !== 'undefined' ? (window as CoreWindow) : undefined;
const apiBase =
  typeof globalWindow?.__CORE_API__ === 'string' ? (globalWindow.__CORE_API__ as string) : 'https://api.berjis.tech';

export const environment = {
  production: false,
  staging: false,
  apiBase
};
