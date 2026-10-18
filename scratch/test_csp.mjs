import { loosenedCsp } from '../test/assets.test.mjs';
const orig = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'">`;
const wider = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:">`;
console.log('loosened:', loosenedCsp(orig, wider));
