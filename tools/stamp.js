/* Version + cache stamp, one step.  Run before every deploy:
     node tools/stamp.js
   The ritual itself lives in ForgeKit (web/vendor/forgekit/stamp.mjs).
   serve.py sends no-store, so there are no ?v= stamps to rewrite here;
   the visible #ver chip (.version-tag) is the point. */
import('../web/vendor/forgekit/stamp.mjs').then(m => m.stamp({
  root: new URL('..', import.meta.url),
  globalName: 'TRUSSFORGE_VERSION',
}));
