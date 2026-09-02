import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  api,
  clearStoredAuthTokens,
  restoreDesktopAuthSession,
  storeAuthTokens,
  syncDesktopAuthIfRequested,
} from '../utils/api';
import { setStoredAnalysisLanguagePreference } from '../utils/analysisLanguagePreference';
import { areEquivalentLocalKernelConfigs, shouldBlockAuthStatusCheck } from './authLoading';

const AuthContext = createContext({
  user: null,
  token: null,
  localKernelConfig: null,
  login: () => {},
  register: () => {},
  logout: () => {},
  isLoading: true,
  needsSetup: false,
  hasCompletedOnboarding: true,
  refreshOnboardingStatus: () => {},
  refreshUser: () => {},
  error: null
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('auth-token'));
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [localKernelConfig, setLocalKernelConfig] = useState(null);
  const [error, setError] = useState(null);
  const hasCompletedInitialAuthCheckRef = useRef(false);
  const presenceInFlightRef = useRef(false);

  const syncUserPreferences = useCallback((nextUser) => {
    if (nextUser?.analysisLanguagePreference) {
      setStoredAnalysisLanguagePreference(null, nextUser.analysisLanguagePreference);
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, [token]);

  useEffect(() => {
    const handleTokenRefreshed = (event) => {
      const nextToken = event?.detail?.token || localStorage.getItem('auth-token');
      if (nextToken) {
        setToken(nextToken);
      }
    };

    const handleSessionExpired = () => {
      clearStoredAuthTokens();
      setToken(null);
      setUser(null);
    };

    const handleAuthStorageChange = (event) => {
      if (event.key !== 'auth-token') {
        return;
      }
      const nextToken = event.newValue || null;
      setToken(nextToken);
      if (!nextToken) {
        setUser(null);
      }
    };

    window.addEventListener('medhelp-auth-token-refreshed', handleTokenRefreshed);
    window.addEventListener('medhelp-auth-session-expired', handleSessionExpired);
    window.addEventListener('storage', handleAuthStorageChange);
    return () => {
      window.removeEventListener('medhelp-auth-token-refreshed', handleTokenRefreshed);
      window.removeEventListener('medhelp-auth-session-expired', handleSessionExpired);
      window.removeEventListener('storage', handleAuthStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setHasCompletedOnboarding(true);
    }
  }, [user]);

  useEffect(() => {
    if (!token || !user) return undefined;
    const sendPresence = async () => {
      if (presenceInFlightRef.current) return;
      presenceInFlightRef.current = true;
      try {
        const response = await api.auth.presence();
        if (!response.ok) return;
        const data = await response.json();
        if (data.sessionMigrated && data.accessToken) {
          const nextToken = storeAuthTokens(data);
          if (nextToken) setToken(nextToken);
        }
      } catch {
        // Presence is best-effort and should never interrupt the active page.
      } finally {
        presenceInFlightRef.current = false;
      }
    };
    sendPresence();
    const intervalId = window.setInterval(sendPresence, 45_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') sendPresence();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [token, user?.id]);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (response.ok) {
        const data = await response.json();
        setHasCompletedOnboarding(data.hasCompletedOnboarding);
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      if (error?.code === 'LOCAL_KERNEL_REQUIRED') {
        return;
      }
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const refreshUser = useCallback(async () => {
    const userResponse = await api.auth.user();

    if (!userResponse.ok) {
      return null;
    }

    const userData = await userResponse.json();
    setUser(userData.user);
    syncUserPreferences(userData.user);
    return userData.user;
  }, [syncUserPreferences]);

  const checkAuthStatus = async () => {
    const shouldBlockUi = shouldBlockAuthStatusCheck(hasCompletedInitialAuthCheckRef.current);
    try {
      // Token rotation is a background revalidation. Replacing the protected
      // app with the loading screen here unmounts the chat UI and looks like a
      // full-page flash while an agent is working.
      if (shouldBlockUi) {
        setIsLoading(true);
      }
      setError(null);

      let activeToken = token;
      if (!activeToken && !hasCompletedInitialAuthCheckRef.current) {
        const restoredSession = await restoreDesktopAuthSession();
        if (restoredSession) {
          activeToken = storeAuthTokens(restoredSession);
          if (activeToken) setToken(activeToken);
        }
      }

      // Check if system needs setup
      const statusResponse = await api.auth.status();
      const statusData = await statusResponse.json();
      const nextLocalKernelConfig = statusData.localKernel || null;
      setLocalKernelConfig((currentConfig) => (
        areEquivalentLocalKernelConfigs(currentConfig, nextLocalKernelConfig)
          ? currentConfig
          : nextLocalKernelConfig
      ));

      if (statusData.needsSetup) {
        setNeedsSetup(true);
        setUser(null);
        return;
      }

      setNeedsSetup(false);

      const applyLocalNoAuthSession = () => {
        if (!statusData.localNoAuth) return null;
        const issuedToken = storeAuthTokens(statusData);
        if (!issuedToken) return null;
        activeToken = issuedToken;
        setToken(issuedToken);
        return issuedToken;
      };

      if (!activeToken) {
        applyLocalNoAuthSession();
      }

      const acceptVerifiedUser = async (verifiedUser, sessionToken) => {
        syncDesktopAuthIfRequested({
          accessToken: sessionToken,
          refreshToken: localStorage.getItem('auth-refresh-token'),
          user: verifiedUser,
        }).catch(() => {});
        setNeedsSetup(false);
        await checkOnboardingStatus();
      };

      // If we have a token, verify it
      if (activeToken) {
        try {
          const currentUser = await refreshUser();
          if (currentUser) {
            await acceptVerifiedUser(currentUser, activeToken);
          } else {
            clearStoredAuthTokens();
            setToken(null);
            setUser(null);
            if (applyLocalNoAuthSession()) {
              const recoveredUser = await refreshUser();
              if (recoveredUser) {
                await acceptVerifiedUser(recoveredUser, activeToken);
              } else {
                setUser(null);
              }
            }
          }
        } catch (error) {
          console.error('Token verification failed:', error);
          clearStoredAuthTokens();
          setToken(null);
          setUser(null);
          if (applyLocalNoAuthSession()) {
            try {
              const recoveredUser = await refreshUser();
              if (recoveredUser) {
                await acceptVerifiedUser(recoveredUser, activeToken);
              } else {
                setUser(null);
              }
            } catch {
              setUser(null);
            }
          }
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('[AuthContext] Auth status check failed:', error);
      setError('Failed to check authentication status');
    } finally {
      hasCompletedInitialAuthCheckRef.current = true;
      if (shouldBlockUi) {
        setIsLoading(false);
      }
    }
  };

  const login = async (username, password) => {
    try {
      setError(null);
      const response = await api.auth.login(username, password);

      const data = await response.json();

      if (response.ok) {
        const nextToken = storeAuthTokens(data);
        setToken(nextToken);
        setUser(data.user);
        syncUserPreferences(data.user);
        await checkOnboardingStatus();
        return { success: true };
      } else {
        setError(data.error || 'Login failed');
        return { success: false, error: data.error || 'Login failed', code: data.code || null };
      }
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = 'Network error. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const register = async (
    username,
    password,
    notificationEmail,
    acceptedLegalTerms = false,
  ) => {
    try {
      setError(null);
      const response = await api.auth.register(
        username,
        password,
        notificationEmail,
        acceptedLegalTerms,
      );

      const data = await response.json();

      if (response.ok) {
        const nextToken = storeAuthTokens(data);
        setToken(nextToken);
        setUser(data.user);
        syncUserPreferences(data.user);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } else {
        setError(data.error || 'Registration failed');
        return { success: false, error: data.error || 'Registration failed' };
      }
    } catch (error) {
      console.error('Registration error:', error);
      const errorMessage = 'Network error. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const logout = () => {
    const logoutRequest = token ? api.auth.logout() : null;
    setToken(null);
    setUser(null);
    clearStoredAuthTokens();

    if (logoutRequest) {
      logoutRequest.catch(error => {
        console.error('Logout endpoint error:', error);
      });
    }
  };

  const value = {
    user,
    token,
    login,
    register,
    logout,
    isLoading,
    needsSetup,
    hasCompletedOnboarding,
    localKernelConfig,
    refreshOnboardingStatus,
    refreshUser,
    error
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
