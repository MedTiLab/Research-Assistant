import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { TaskMasterProvider } from './contexts/TaskMasterContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppContent from './components/app/AppContent';
import SurveyDiagramWindow from './components/survey/view/SurveyDiagramWindow';
import ConversationSharePage from './components/share/ConversationSharePage';
import DownloadPage from './components/downloads/DownloadPage';
import LocalKernelBoundary from './components/local-kernel/LocalKernelBoundary';
import ErrorBoundary from './components/ErrorBoundary';
import DesktopRuntimeStatusBanner from './components/app/DesktopRuntimeStatusBanner';
import { LocalKernelProvider } from './state/localKernelStore';
import { DesktopRuntimeProvider } from './contexts/DesktopRuntimeContext';
import { getDesktopRuntimeInfo } from './utils/desktopRuntime';
import i18n from './i18n/config.js';
import DesktopCompanionWindow from './features/companions/DesktopCompanionWindow';

function ProtectedAppContent() {
  return (
    <ProtectedRoute>
      <LocalKernelBoundary>
        <AppContent />
      </LocalKernelBoundary>
    </ProtectedRoute>
  );
}

function DesktopWindowFrame() {
  return getDesktopRuntimeInfo().isDesktopShell
    ? <div className="medhelp-desktop-titlebar" aria-hidden="true" />
    : null;
}

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <DesktopRuntimeProvider>
          <DesktopWindowFrame />
          <DesktopRuntimeStatusBanner />
          <ErrorBoundary showDetails fullScreen>
            <AuthProvider>
              <LocalKernelProvider>
                <WebSocketProvider>
                  <TaskMasterProvider>
                      <Router basename={window.__ROUTER_BASENAME__ || ''}>
                        <Routes>
                          <Route path="/share/:token" element={<ConversationSharePage />} />
                          <Route
                            path="/download"
                            element={(
                              <ProtectedRoute>
                                <DownloadPage />
                              </ProtectedRoute>
                            )}
                          />
                          <Route
                            path="/desktop-companion"
                            element={(
                              <ProtectedRoute>
                                <LocalKernelBoundary>
                                  <DesktopCompanionWindow />
                                </LocalKernelBoundary>
                              </ProtectedRoute>
                            )}
                          />
                          <Route path="/" element={<ProtectedAppContent />} />
                          <Route path="/session/:sessionId" element={<ProtectedAppContent />} />
                          <Route path="/variable-knowledge/pubmed-discovery" element={<ProtectedAppContent />} />
                          <Route
                            path="/survey/diagram"
                            element={(
                              <ProtectedRoute>
                                <LocalKernelBoundary>
                                  <SurveyDiagramWindow />
                                </LocalKernelBoundary>
                              </ProtectedRoute>
                            )}
                          />
                        </Routes>
                      </Router>
                  </TaskMasterProvider>
                </WebSocketProvider>
              </LocalKernelProvider>
            </AuthProvider>
          </ErrorBoundary>
        </DesktopRuntimeProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
