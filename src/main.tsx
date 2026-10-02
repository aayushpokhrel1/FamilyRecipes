import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './context/AuthContext'
import { FamilyProvider } from './context/FamilyContext'
import AppRoutes from './routes'
import SiteFooter from './components/SiteFooter'
import { reportError } from './lib/api/errorLog'

// Nearly every failure in this app is caught and shown to the person who hit it, so the
// catch blocks that report are the ones that see them. These two listeners exist for the
// failures no catch block ever saw: a throw during render, or a promise nobody awaited.
window.addEventListener("error", (e) => reportError("window:error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => reportError("window:unhandledrejection", e.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FamilyProvider>
          {/* The footer sits OUTSIDE AppRoutes on purpose. It carries the terms, privacy and
              cookie links, and those have to be reachable from the signed-out auth pages,
              which render bare and never pass through AppLayout. */}
          <div className="site">
            <AppRoutes />
            <SiteFooter />
          </div>
        </FamilyProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
