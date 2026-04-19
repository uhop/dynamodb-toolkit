// Split a wire-format patch body into {patch, options} for buildUpdate.
// Body shape: {field: value, _delete: [...], _separator: '.', _arrayOps: [...]}.
// metaPrefix configurable; default '_'.

export const parsePatch = (body, options = {}) => {
  const metaPrefix = options.metaPrefix || '_';
  // Null-prototype accumulators: a body key of '__proto__' would otherwise
  // invoke the prototype setter on a plain `{}` and pollute the result's chain.
  const patch = Object.create(null);
  const patchOptions = Object.create(null);

  if (!body || typeof body !== 'object') return {patch, options: patchOptions};

  for (const key of Object.keys(body)) {
    if (!key.startsWith(metaPrefix)) {
      patch[key] = body[key];
      continue;
    }
    const meta = key.slice(metaPrefix.length);
    switch (meta) {
      case 'delete':
        if (Array.isArray(body[key])) patchOptions.delete = body[key];
        break;
      case 'separator':
        if (typeof body[key] === 'string' && body[key]) patchOptions.separator = body[key];
        break;
      case 'arrayOps':
        if (Array.isArray(body[key])) patchOptions.arrayOps = body[key];
        break;
      default:
        // Unknown meta keys are silently dropped; caller may inspect raw body if needed.
        break;
    }
  }
  return {patch, options: patchOptions};
};
