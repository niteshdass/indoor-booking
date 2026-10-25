/** Path under the owner tenant: `/owners/:ownerId` plus an optional sub-path. */
export function ownerPath(ownerId: string, path = ''): string {
  return `/owners/${ownerId}${path}`;
}
