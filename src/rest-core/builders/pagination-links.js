// Compute prev/next pagination links from offset/limit/total + a URL builder.
// urlBuilder: ({offset, limit}) => string. Returns {prev: string|null, next: string|null}.
// Without a urlBuilder this returns null for both — caller can construct URLs separately.

export const paginationLinks = (offset, limit, total, urlBuilder) => {
  const out = {prev: null, next: null};
  if (!urlBuilder) return out;
  if (offset > 0) {
    const prevOffset = Math.max(0, offset - limit);
    out.prev = urlBuilder({offset: prevOffset, limit});
  }
  if (typeof total === 'number') {
    if (offset + limit < total) {
      out.next = urlBuilder({offset: offset + limit, limit});
    }
  } else if (offset + limit >= 0) {
    // Without total we can't tell if there's a next page; caller decides via hasMore hint.
    out.next = urlBuilder({offset: offset + limit, limit});
  }
  return out;
};
