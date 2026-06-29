// @ts-self-types="./stamp.d.ts"
// Canned prepare-hook builders for the common `createdAt` stamping pattern.
//
// Every `asOf`-using adapter declaration wants the same 4-line `prepare`
// hook: stamp `createdAtField` on first insert, leave patches alone, let
// round-tripped items keep their existing value. These factories return
// exactly that hook pre-baked.
//
// Composition: if you have additional prepare logic, wrap the returned
// function — `prepare: (item, isPatch) => myOtherPrepare(stampCreatedAtISO()(item, isPatch), isPatch)`.

const stamp = (fieldName, encode) => {
  return (item, isPatch) => {
    if (isPatch || item[fieldName] !== undefined) return item;
    return {...item, [fieldName]: encode()};
  };
};

export const stampCreatedAtISO = (fieldName = '_createdAt') => stamp(fieldName, () => new Date().toISOString());

export const stampCreatedAtEpoch = (fieldName = '_createdAt') => stamp(fieldName, () => Date.now());
