// Token storage utility for JWT authentication
// Manages access tokens, refresh tokens, and current database selection

const ACCESS_TOKEN_KEY = 'billmanager_access_token';
const REFRESH_TOKEN_KEY = 'billmanager_refresh_token';
const CURRENT_DATABASE_KEY = 'billmanager_current_database';

export const TokenStorage = {
  /**
   * Store both access and refresh tokens
   */
  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },

  /**
   * Get the current access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },

  /**
   * Get the current refresh token
   */
  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },

  /**
   * Clear all tokens (logout)
   */
  clearTokens(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(CURRENT_DATABASE_KEY);
  },

  /**
   * Set the current database (used for X-Database header)
   */
  setCurrentDatabase(dbName: string): void {
    localStorage.setItem(CURRENT_DATABASE_KEY, dbName);
  },

  /**
   * Get the current database name
   */
  getCurrentDatabase(): string | null {
    return localStorage.getItem(CURRENT_DATABASE_KEY);
  },

  /**
   * Clear only the database selection (keep auth tokens)
   */
  clearCurrentDatabase(): void {
    localStorage.removeItem(CURRENT_DATABASE_KEY);
  },
};
