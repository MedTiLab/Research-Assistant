import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';

const inputClassName =
  'h-10 w-full rounded-md border border-[#d7d7d7] bg-white px-3 py-2 text-sm text-[#171717] shadow-sm caret-[#0e9f6e] placeholder:text-[#9ca3af] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0e9f6e] disabled:cursor-not-allowed disabled:bg-[#f3f4f6] disabled:text-[#6b7280] disabled:opacity-60';

const LoginForm = () => {
  const { t } = useTranslation('auth');
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      setError(t('login.errors.requiredFields'));
      return;
    }

    setIsLoading(true);
    const result = await login(normalizedIdentifier);
    if (!result.success) {
      if (result.code === 'DEVICE_LIMIT_REACHED') {
        setError(t('login.errors.deviceLimitReached'));
      } else if (result.code === 'ACCOUNT_NOT_FOUND_USE_EMAIL') {
        setError(t('login.errors.accountNotFoundUseEmail'));
      } else {
        setError(result.error || t('login.errors.networkError'));
      }
    }
    setIsLoading(false);
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[#f7f7f7] px-4 py-10 text-[#171717]"
      style={{ colorScheme: 'light' }}
    >
      <section className="w-full max-w-[420px]">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-[#171717]">{t('login.title')}</h2>
          <p className="mt-2 text-sm leading-6 text-[#666666]">{t('login.description')}</p>
        </div>

        <div className="rounded-lg border border-[#dedede] bg-white p-6 shadow-lg shadow-slate-950/5 md:p-7">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-identifier" className="mb-1.5 block text-sm font-medium text-[#171717]">
                {t('login.username')}
              </label>
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                className={inputClassName}
                placeholder={t('login.placeholders.username')}
                required
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#0e9f6e] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0c8f63] disabled:bg-[#0e9f6e]/60"
            >
              {isLoading ? t('login.loading') : t('login.submit')}
              {!isLoading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          <p className="mt-5 border-t border-[#dedede] pt-5 text-sm leading-6 text-[#666666]">
            {t('login.autoCreateHint')}
          </p>
        </div>
      </section>
    </div>
  );
};

export default LoginForm;
