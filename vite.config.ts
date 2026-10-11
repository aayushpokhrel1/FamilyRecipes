import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// TWO apps, one build, one Worker. index.html is the family app on
// recipes.enamelvault.com; kitchen.html is the professional-kitchen app on
// kitchen.enamelvault.com, and the Worker serves it by hostname.
//
// kitchen.html lives at the repo root because it must be BUILT. In public/ it would be
// copied verbatim and would ship an entry pointing at /src/kitchen/main.tsx, which exists
// only in dev. The published URL never shows the filename: the Worker fetches it internally
// and refuses it as a path, exactly as it does for site.html.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        kitchen: resolve(__dirname, 'kitchen.html'),
      },
    },
  },
})
