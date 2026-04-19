// Map TransactionCanceledException.CancellationReasons back to input descriptors.

const collectActions = (requests, out) => {
  for (const r of requests) {
    if (!r) continue;
    if (Array.isArray(r)) {
      collectActions(r, out);
      continue;
    }
    if (r.action) out.push(r);
  }
};

const formatFailure = f => {
  const loc = f.descriptor?.params?.TableName ? ` (${f.descriptor.action} to ${f.descriptor.params.TableName})` : '';
  const suffix = f.message ? ` — ${f.message}` : '';
  return `action ${f.index}${loc}: ${f.code}${suffix}`;
};

export const explainTransactionCancellation = (err, ...requests) => {
  if (!err || err.name !== 'TransactionCanceledException') return null;
  const reasons = err.CancellationReasons || [];
  const descriptors = [];
  collectActions(requests, descriptors);

  const failures = [];
  for (let i = 0; i < reasons.length; i++) {
    const reason = reasons[i];
    if (!reason || !reason.Code || reason.Code === 'None') continue;
    failures.push({
      index: i,
      descriptor: descriptors[i],
      code: reason.Code,
      message: reason.Message,
      item: reason.Item
    });
  }

  const summary = failures.length ? failures.map(formatFailure).join('; ') : 'no failure details';
  return {failures, message: `Transaction canceled: ${summary}`};
};
