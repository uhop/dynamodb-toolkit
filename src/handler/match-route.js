// Match an HTTP method + URL pathname to one of the standard route shapes.
// Returns a discriminated result; caller dispatches.
//
// HEAD requests are matched as GET (so they dispatch through the same
// read-side handler) and annotated with `head: true` on the result so the
// caller can skip body writes in the response — the REST convention is that
// HEAD returns the same headers + Content-Length as the equivalent GET but
// an empty body.

const splitPath = path => {
  let start = 0,
    end = path.length;
  while (start < end && path[start] === '/') start++;
  while (end > start && path[end - 1] === '/') end--;
  return path.slice(start, end).split('/');
};

export const matchRoute = (method, path, methodPrefix = '-') => {
  const isHead = method === 'HEAD';
  const effectiveMethod = isHead ? 'GET' : method;
  const parts = splitPath(path);
  const isMethod = s => s.startsWith(methodPrefix) && s.length > methodPrefix.length;

  if (parts.length === 1 && parts[0] === '') {
    return {kind: 'root', method: effectiveMethod, head: isHead};
  }
  if (parts.length === 1 && isMethod(parts[0])) {
    return {kind: 'collectionMethod', name: parts[0].slice(methodPrefix.length), method: effectiveMethod, head: isHead};
  }
  if (parts.length === 1) {
    return {kind: 'item', key: decodeURIComponent(parts[0]), method: effectiveMethod, head: isHead};
  }
  if (parts.length === 2 && isMethod(parts[1])) {
    return {
      kind: 'itemMethod',
      key: decodeURIComponent(parts[0]),
      name: parts[1].slice(methodPrefix.length),
      method: effectiveMethod,
      head: isHead
    };
  }
  return {kind: 'unknown', method: effectiveMethod, head: isHead};
};
