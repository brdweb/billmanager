/** Physical SQLite keys include the immutable account identity, never API names. */
export interface PrincipalScope {
  databaseId: string;
  principalId?: string;
}

const prefix = '@principal/';
export function storageDatabaseId(scope: PrincipalScope): string {
  return scope.principalId
    ? `${prefix}${encodeURIComponent(scope.principalId)}/${scope.databaseId}`
    : scope.databaseId;
}

export function decodeStorageDatabaseId(databaseId: string): PrincipalScope {
  if (!databaseId.startsWith(prefix)) return { databaseId };
  const separator = databaseId.indexOf('/', prefix.length);
  if (separator < 0) return { databaseId };
  return {
    principalId: decodeURIComponent(databaseId.slice(prefix.length, separator)),
    databaseId: databaseId.slice(separator + 1),
  };
}
