const w = typeof window !== 'undefined' ? (window as any) : {};

export const environment = {
  production: false,
  apiBase: w.__CORE_API__ || 'https://api.berjis.tech'
};
