/**
 * Strip a configured mount path from a request pathname.
 *
 * Returns the tail (starting with `/`) when `pathname` begins with `mountPath`,
 * or `null` when the request falls outside the mount. Trailing slashes on
 * `mountPath` are normalized so `'/planets/'` and `'/planets'` behave
 * identically.
 *
 * @param pathname Incoming request pathname (e.g. `req.url`'s path component).
 * @param mountPath Configured mount prefix. `''` / `undefined` means "root".
 * @returns The pathname relative to the mount (always starts with `/`), or
 *   `null` when the pathname isn't under the mount.
 */
export function stripMount(pathname: string, mountPath?: string): string | null;
