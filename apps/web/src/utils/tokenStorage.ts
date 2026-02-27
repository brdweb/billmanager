// Token storage utility for JWT authentication.
// Keeps access token in memory and database selection in localStorage.

const CURRENT_DATABASE_KEY = 'billmanager_current_database';
let accessTokenMemory: string | null = null;

export const TokenStorage = {
  /**
   * Store access token in memory only.
   * Refresh tokens are stored in secure HttpOnly cookies by the server.
   */
  setTokens(accessToken: string): void {
    accessTokenMemory = accessToken;
  },

  /**
   * Get the current access token
   */
  getAccessToken(): string | null {
    return accessTokenMemory;
  },

  /**
   * Clear all tokens (logout)
   */
  clearTokens(): void {
    accessTokenMemory = null;
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
