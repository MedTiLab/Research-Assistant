import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ClaudeLogo from './ClaudeLogo';
import { isEmailLikeUsername } from '../../shared/usernamePolicy.js';

const SetupForm = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (username.length < 3) {
      setError('Username must be at least 3 characters long');
      return;
    }

    if (isEmailLikeUsername(username)) {
      setError('Username cannot be an email address');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(notificationEmail.trim())) {
      setError('A valid email is required');
      return;
    }

    if (!legalAccepted) {
      setError('Please read and agree to the copyright notice and database usage rules.');
      return;
    }

    setIsLoading(true);

    const result = await register(
      username,
      password,
      notificationEmail.trim(),
      legalAccepted,
    );

    if (!result.success) {
      setError(result.error);
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <ClaudeLogo size={64} />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome to MedHelp</h1>
            <p className="text-muted-foreground mt-2">
              Set up your account to get started
            </p>
          </div>

          {/* Setup Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your username"
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="notificationEmail" className="block text-sm font-medium text-foreground mb-1">
                Email
              </label>
              <input
                type="email"
                id="notificationEmail"
                value={notificationEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your email"
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your password"
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Confirm your password"
                required
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
              <input
                type="checkbox"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
                required
                disabled={isLoading}
                className="mt-1 h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
              />
              <span>
                I have read and agree to the copyright notice and database usage rules, and I understand that third-party datasets must be independently authorized before use.
              </span>
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md transition-colors duration-200"
            >
              {isLoading ? 'Setting up...' : 'Create Account'}
            </button>
          </form>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Create the first account to initialize your MedHelp workspace.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupForm;
