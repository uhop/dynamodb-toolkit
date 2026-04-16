// Build a standard error envelope: {code, message}. Extensible via options.

export const buildErrorBody = (err, options = {}) => {
  const out = {
    code: err?.code || err?.name || 'Error',
    message: err?.message || 'Unknown error'
  };
  if (options.errorId) out.errorId = options.errorId;
  if (options.includeDebug && err?.stack) out.stack = err.stack;
  return out;
};
