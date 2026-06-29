// @ts-self-types="./sleep.d.ts"
// Promise-based delay.

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
