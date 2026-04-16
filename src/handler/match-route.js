// Match an HTTP method + URL pathname to one of the standard route shapes.
// Returns a discriminated result; caller dispatches.

const splitPath = path => path.replace(/^\/+/, '').replace(/\/+$/, '').split('/');

export const matchRoute = (method, path, methodPrefix = '-') => {
  const parts = splitPath(path);
  const isMethod = s => s.startsWith(methodPrefix) && s.length > methodPrefix.length;

  if (parts.length === 1 && parts[0] === '') {
    return {kind: 'root', method};
  }
  if (parts.length === 1 && isMethod(parts[0])) {
    return {kind: 'collectionMethod', name: parts[0].slice(methodPrefix.length), method};
  }
  if (parts.length === 1) {
    return {kind: 'item', key: decodeURIComponent(parts[0]), method};
  }
  if (parts.length === 2 && isMethod(parts[1])) {
    return {kind: 'itemMethod', key: decodeURIComponent(parts[0]), name: parts[1].slice(methodPrefix.length), method};
  }
  return {kind: 'unknown', method};
};
