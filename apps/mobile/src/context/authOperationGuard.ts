export interface AuthOperationToken {
  profileId: string;
  authGeneration: number;
}

export interface DatabaseOperationToken extends AuthOperationToken {
  databaseId: string | null;
  databaseGeneration: number;
}

export interface RuntimeScope {
  serverProfileId: string;
  databaseId: string | null;
  principalId?: string;
}

/**
 * Provider-local ordering guard for authentication and database work.
 *
 * Authentication invalidation also invalidates every database operation. A
 * database selection only invalidates database-dependent work, so a profile
 * level `/me` refresh may still update the user and database list while it
 * preserves the newer selection.
 */
export class AuthOperationGuard {
  private authGeneration = 0;

  private databaseGeneration = 0;

  captureAuth(profileId: string): AuthOperationToken {
    return { profileId, authGeneration: this.authGeneration };
  }

  captureDatabase(scope: RuntimeScope): DatabaseOperationToken {
    return {
      ...this.captureAuth(scope.serverProfileId),
      databaseId: scope.databaseId,
      databaseGeneration: this.databaseGeneration,
    };
  }

  beginDatabaseSelection(
    profileId: string,
    databaseId: string | null,
  ): DatabaseOperationToken {
    this.databaseGeneration += 1;
    return {
      ...this.captureAuth(profileId),
      databaseId,
      databaseGeneration: this.databaseGeneration,
    };
  }

  invalidateAuthentication(profileId: string): AuthOperationToken {
    this.authGeneration += 1;
    this.databaseGeneration += 1;
    return this.captureAuth(profileId);
  }

  isAuthCurrent(token: AuthOperationToken, activeProfileId: string): boolean {
    return token.profileId === activeProfileId
      && token.authGeneration === this.authGeneration;
  }

  isDatabaseCurrent(
    token: DatabaseOperationToken,
    activeScope: RuntimeScope,
  ): boolean {
    return this.isAuthCurrent(token, activeScope.serverProfileId)
      && token.databaseGeneration === this.databaseGeneration
      && token.databaseId === activeScope.databaseId;
  }
}

/**
 * Serializes durable auth-session writes. If an older write is already in
 * flight when logout or a newer database selection starts, the newer clear or
 * selection write is guaranteed to run after it and therefore owns the final
 * persisted state.
 */
export class SerializedAuthSessionWrites {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function runtimeScopeIsAligned(
  contextScope: RuntimeScope,
  apiScope: RuntimeScope,
): boolean {
  return contextScope.serverProfileId === apiScope.serverProfileId
    && contextScope.databaseId === apiScope.databaseId
    && (!contextScope.principalId || contextScope.principalId === apiScope.principalId);
}
