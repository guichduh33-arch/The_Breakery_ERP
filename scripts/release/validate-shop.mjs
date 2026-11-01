// Produit un paquet de test non installable ; aucune preuve de production inventée.
import { resolve } from 'node:path';
import { git, ROOT } from '../agents/lib.mjs';
import { packageShop } from './package-shop.mjs';
import { PRODUCTION_REF } from './verify-shop.mjs';
const sha = git(['rev-parse','HEAD']);
await packageShop(ROOT, resolve(ROOT, '.release-manifests/shop-validation'),
  { sha, projectRef: PRODUCTION_REF, proofs: [] }, true);
console.log(JSON.stringify({ validationOnly: true, installable: false, sha }));
