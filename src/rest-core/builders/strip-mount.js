// Strip a configured mount path from a request pathname.
//
// Returns the tail (starting with '/') when `pathname` begins with `mountPath`,
// or `null` when the request falls outside the mount. A null return tells the
// adapter to 404 (or defer to the framework) without invoking the router.
//
// Trailing slashes on `mountPath` are normalized away at the boundary so
// `mountPath: '/planets/'` and `mountPath: '/planets'` behave identically.
// An empty / missing `mountPath` means "mount at root" — every request passes.

export const stripMount = (pathname, mountPath) => {
  if (!mountPath) return pathname || '/';
  // Normalize trailing slashes so the configured mountPath is canonical.
  let mount = mountPath;
  while (mount.length > 1 && mount.endsWith('/')) mount = mount.slice(0, -1);
  if (!pathname.startsWith(mount)) return null;
  const rest = pathname.slice(mount.length);
  if (rest === '') return '/';
  if (rest[0] !== '/') return null; // partial match — e.g. mount=/planets, path=/planetsburg
  return rest;
};
