import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

export default {
  packagerConfig: {
    name: 'CCodeBox',
    executableName: 'ccodebox',
    icon: 'assets/icon.icns',
    // @electron-forge/plugin-vite auto-sets packagerConfig.ignore to exclude everything
    // except the '.vite' build output, on the assumption that Vite bundles all deps into
    // the JS. That's true for everything except node-pty, which vite.main.config.ts
    // externalizes (see the comment there) — so real node_modules files must survive
    // packaging, or `require("node-pty")` finds nothing.
    //
    // Just allowing '/node_modules/node-pty' through here is NOT enough: @electron/packager
    // copies via fs-extra's copy(), which short-circuits at the *directory* level — if the
    // filter rejects the bare '/node_modules' entry, it never recurses into it at all, so a
    // path-prefix check scoped to node-pty alone never even gets evaluated. Instead let all of
    // '/node_modules' through here and rely on packagerConfig.prune (on by default), which
    // walks the real package.json dependency graph and keeps only production deps (node-pty
    // included) while still dropping devDependencies like vite/typescript/electron itself.
    ignore: (file) => {
      if (!file) return false;
      if (file.startsWith('/.vite')) return false;
      if (file.startsWith('/node_modules')) return false;
      return true;
    },
    // node-pty's prebuilt .node binaries can't be dlopen'd from inside an asar
    // archive, so they need to be unpacked onto real disk in the packaged app.
    asar: {
      unpack: '**/node-pty/**/*',
    },
  },
  makers: [new MakerDMG({ icon: 'assets/icon.icns' }), new MakerZIP({})],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' },
      ],
    }),
  ],
};
