// Node import hooks for dev/anim-bench-node.mjs: the bare 'three' resolves to the vendored build, as the import map does
// in a page. Used as  node --import ./dev/anim-bench-hooks.mjs ...
import { register } from 'node:module';
const ROOT = process.env.ROOT;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify('file://' + ROOT + '/vendor/three.min.js')}, shortCircuit: true };
  return next(spec, ctx);
}`));
