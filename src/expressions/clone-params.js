// @ts-self-types="./clone-params.d.ts"
// Shallow-clone params with its expression attribute maps.

export const cloneParams = params => ({
  ...params,
  ExpressionAttributeNames: {...params?.ExpressionAttributeNames},
  ExpressionAttributeValues: {...params?.ExpressionAttributeValues}
});
