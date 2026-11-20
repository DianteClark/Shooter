// Wrenfield Fair's wonder weapon model (js/shared/zombies.js ZM_WONDERS.whirl), kept apart from js/render/guns.js and
// hooked into its FACTORIES by one line, like the Stormcoil's and the Rimecaster's: drawn in place of the gun it rides
// on, in Graveyard Shift only. The Whirligig: a squat brass launcher with a striped drum, a fat flared muzzle holding a
// spinning top (lit, in the accent), and a crank on the side. Low-poly and read from above by its silhouette: the wide
// muzzle disc and the drum.
export function fairWonderFactories({ kit, pistolGrip }) {
  return {
    'zw-whirl': () => {
      const k = kit(), b = k.b;
      k.body().box(0.02, 0.2, 0, 0.5, 0.22, 0.2, 0.03);                                        // Receiver.
      k.metal().prismX(-0.3, 0.02, 0.24, 0, 0.15, 0.15, 8);                                   // The drum.
      k.accent(); for (let i = 0; i < 3; i++) b.prismX(-0.26 + i * 0.1, -0.22 + i * 0.1, 0.24, 0, 0.16, 0.16, 8);   // Its stripes.
      k.dark().prismX(0.26, 0.5, 0.21, 0, 0.07, 0.07, 8);                                     // Barrel.
      k.metal().prismX(0.5, 0.66, 0.21, 0, 0.08, 0.17, 10);                                   // Flared muzzle.
      k.accent().prismX(0.6, 0.68, 0.21, 0, 0.11, 0.04, 6);                                   // The top, waiting in it.
      k.dark().box(-0.05, 0.25, 0.17, 0.04, 0.04, 0.12); k.dark().box(-0.05, 0.31, 0.24, 0.12, 0.04, 0.04);           // Crank.
      pistolGrip(k, 0.0, 0.32, 0.14);
      return { geometry: b.build(), muzzle: [0.7, 0.21, 0], fore: [0.3, 0.02, -0.05], eject: [0.05, 0.3, 0.1], length: 1.0 };
    },
  };
}
