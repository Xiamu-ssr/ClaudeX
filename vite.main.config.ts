import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // node-pty resolves its prebuilt .node binary via a path relative to its own
      // lib/ directory at require-time — bundling its JS into main.js would resolve
      // that path relative to .vite/build/ instead, so it must stay a real require().
      external: ['node-pty'],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
