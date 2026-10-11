const configuredApiUrl = import.meta.env.VITE_API_URL;
const defaultApiUrl = import.meta.env.DEV ? 'http://localhost:8000' : '';

export const API_BASE_URL = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, '');
