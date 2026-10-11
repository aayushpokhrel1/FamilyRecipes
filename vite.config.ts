import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'

// TWO apps, one build, one Worker. index.html is the family app on
// recipes.enamelvault.com; kitchen.html is the professional-kitchen app on
// kitchen.enamelvault.com, and the Worker serves it by hostname.
//
// kitchen.html lives at the repo root because it must be BUILT. In public/ it would be
// copied verbatim and would ship an entry pointing at /src/kitchen/main.tsx, which exists
// only in dev. The published URL never shows the filename: the Worker fetches it internally
// and refuses it as a path, exactly as it does for site.html.

/**
 * Hostname routing in DEV, so the kitchen app is reachable at its own routes.
 *
 * Without this the kitchen app cannot be walked in development at all, which was discovered
 * by trying: opening /kitchen.html renders NOTHING, because the router sees the pathname
 * "/kitchen.html" and no route matches it, and navigating to /signin instead gets Vite's
 * fallback, which is the FAMILY app's index.html. A browser pass is the only thing that has
 * ever found the real defects in this project, so an app that cannot be opened in dev is not
 * a small inconvenience.
 *
 * `kitchen.localhost` resolves to 127.0.0.1 in browsers without touching any hosts file, so
 * dev now mirrors production exactly: same hostnames deciding the same thing, and the routes
 * are identical in both. Open http://kitchen.localhost:5174/ for the kitchen app and
 * http://localhost:5174/ for the family one.
 */
function kitchenDevHost(): Plugin {
  return {
    name: 'kitchen-dev-host',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const host = (req.headers.host ?? '').split(':')[0]
        const url = req.url ?? '/'
        // Vite's own machinery and every real file must pass through untouched: rewriting
        // /src/kitchen/main.tsx or a .css request to the shell would serve HTML where the
        // browser asked for a module, which fails with no useful message.
        const isModuleOrFile =
          url.startsWith('/@') || url.startsWith('/src/') || url.startsWith('/node_modules/') ||
          /\.[a-z0-9]+(\?|$)/i.test(url)
        if (host === 'kitchen.localhost' && !isModuleOrFile) req.url = '/kitchen.html'
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), kitchenDevHost()],
  server: {
    // kitchen.localhost has to be allowed explicitly: Vite refuses unknown Host headers.
    allowedHosts: ['localhost', 'kitchen.localhost', '127.0.0.1'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        kitchen: resolve(__dirname, 'kitchen.html'),
      },
    },
  },
})
