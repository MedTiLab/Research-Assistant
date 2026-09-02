import React, { useEffect, useState } from 'react';
import { Edit3, Loader2, LockKeyhole, LogIn, LogOut, RefreshCcw, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { isEmailLikeUsername } from '../../../shared/usernamePolicy.js';
import { api } from '../../utils/api';
import UserAvatar from '../user-avatar/UserAvatar';
import ProjectActivityCalendar from './ProjectActivityCalendar';
import LocalKernelSettingsCard from './LocalKernelSettingsCard';
import UserAvatarPicker from './UserAvatarPicker';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AVATAR_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const PROFILE_DRAFT_KEYS = [
  'notificationEmail',
  'displayName',
  'fullName',
  'institution',
  'organization',
  'academicTitle',
  'researchField',
  'usagePurpose',
  'googleScholarUrl',
  'websiteUrl',
  'orcid',
  'aboutYou',
];
const ACCOUNT_PROFILE_FIELDS = [
  { key: 'notificationEmail', type: 'email' },
  { key: 'displayName' },
  { key: 'fullName' },
];
const RESEARCH_PROFILE_FIELDS = [
  { key: 'institution' },
  { key: 'organization' },
  { key: 'academicTitle' },
  { key: 'researchField' },
  { key: 'usagePurpose' },
  { key: 'googleScholarUrl' },
  { key: 'websiteUrl' },
  { key: 'orcid' },
];

function buildProfileDraft(profile = {}) {
  return PROFILE_DRAFT_KEYS.reduce((draft, key) => ({
    ...draft,
    [key]: profile?.[key] || '',
  }), {});
}

export default function UserAccountContent() {
  const { t } = useTranslation(['settings', 'auth']);
  const {
    user,
    login,
    register,
    logout,
    refreshUser,
  } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAuthForm, setShowAuthForm] = useState(() => !user);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState(user?.avatarId || '');
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState(user?.avatarUrl || '');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState(null);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileDraft, setProfileDraft] = useState(() => buildProfileDraft(user));
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileStatus, setProfileStatus] = useState(null);

  const isRegisterMode = mode === 'register';
  const displayName = user?.displayName || user?.username || t('userAccount.currentUserFallback');
  const email = user?.notificationEmail || user?.email || '';

  useEffect(() => {
    setSelectedAvatarId(user?.avatarId || '');
    setSelectedAvatarUrl(user?.avatarUrl || '');
  }, [user?.avatarId, user?.avatarUrl]);

  useEffect(() => {
    setProfileDraft(buildProfileDraft(user));
  }, [
    user?.notificationEmail,
    user?.displayName,
    user?.fullName,
    user?.institution,
    user?.organization,
    user?.academicTitle,
    user?.researchField,
    user?.usagePurpose,
    user?.googleScholarUrl,
    user?.websiteUrl,
    user?.orcid,
    user?.aboutYou,
  ]);

  const resetForm = () => {
    setUsername('');
    setNotificationEmail('');
    setPassword('');
    setConfirmPassword('');
    setLegalAccepted(false);
    setError('');
    setIsLoading(false);
  };

  const resetPasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordLoading(false);
  };

  const getPasswordErrorMessage = (rawError) => {
    if (rawError === 'Current password is incorrect') {
      return t('userAccount.password.errors.currentIncorrect');
    }

    if (rawError === 'Current password and new password are required') {
      return t('userAccount.password.errors.requiredFields');
    }

    if (rawError === 'New password must be at least 6 characters') {
      return t('userAccount.password.errors.passwordLength');
    }

    return rawError || t('userAccount.password.errors.updateFailed');
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    resetForm();
  };

  const handleToggleSwitchAccount = () => {
    setShowPasswordForm(false);
    resetPasswordForm();
    setPasswordStatus(null);
    setShowAuthForm((previous) => {
      const nextValue = !previous;
      if (nextValue) {
        setMode('login');
      } else {
        resetForm();
      }
      return nextValue;
    });
  };

  const handleTogglePasswordForm = () => {
    setShowPasswordForm((previous) => {
      const nextValue = !previous;
      resetPasswordForm();
      setPasswordStatus(null);
      if (nextValue) {
        setShowAuthForm(false);
        resetForm();
      }
      return nextValue;
    });
  };

  const handleToggleProfileForm = () => {
    setShowProfileForm((previous) => {
      const nextValue = !previous;
      setProfileStatus(null);
      if (nextValue) {
        setProfileDraft(buildProfileDraft(user));
        setShowPasswordForm(false);
        resetPasswordForm();
        setPasswordStatus(null);
      }
      return nextValue;
    });
  };

  const handleProfileFieldChange = (field, value) => {
    setProfileDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleResetProfileForm = () => {
    setProfileDraft(buildProfileDraft(user));
    setProfileStatus(null);
  };

  const handleCancelPasswordChange = () => {
    resetPasswordForm();
    setPasswordStatus(null);
    setShowPasswordForm(false);
  };

  const handleCancelProfileEdit = () => {
    handleResetProfileForm();
    setShowProfileForm(false);
  };

  const handleLogout = () => {
    handleCancelPasswordChange();
    logout();
  };

  const handleSelectAvatar = async (avatarId) => {
    if (!user || !avatarId || (avatarId === selectedAvatarId && !selectedAvatarUrl) || avatarLoading) {
      return;
    }

    setAvatarLoading(true);
    setAvatarStatus(null);

    try {
      const response = await api.user.updateAvatar(avatarId);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAvatarStatus({
          success: false,
          message: data?.error || t('userAccount.avatar.errors.saveFailed'),
        });
        return;
      }

      const nextAvatarId = data?.profile?.avatarId || avatarId;
      setSelectedAvatarId(nextAvatarId);
      setSelectedAvatarUrl(data?.profile?.avatarUrl || '');
      await refreshUser?.();
      setAvatarStatus({ success: true, message: t('userAccount.avatar.saved') });
    } catch (avatarError) {
      console.error('Avatar update error:', avatarError);
      setAvatarStatus({ success: false, message: t('userAccount.avatar.errors.networkError') });
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleUploadAvatar = async (file) => {
    if (!user || !file || avatarLoading) {
      return;
    }

    if (!file.type?.startsWith('image/')) {
      setAvatarStatus({ success: false, message: t('userAccount.avatar.errors.invalidFile') });
      return;
    }

    if (file.size > AVATAR_UPLOAD_LIMIT_BYTES) {
      setAvatarStatus({ success: false, message: t('userAccount.avatar.errors.fileTooLarge') });
      return;
    }

    setAvatarLoading(true);
    setAvatarStatus(null);

    try {
      const response = await api.user.uploadAvatar(file);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAvatarStatus({
          success: false,
          message: data?.error || t('userAccount.avatar.errors.uploadFailed'),
        });
        return;
      }

      setSelectedAvatarId(data?.profile?.avatarId || selectedAvatarId || user?.avatarId || '');
      setSelectedAvatarUrl(data?.profile?.avatarUrl || '');
      await refreshUser?.();
      setAvatarStatus({ success: true, message: t('userAccount.avatar.saved') });
    } catch (avatarError) {
      console.error('Avatar upload error:', avatarError);
      setAvatarStatus({ success: false, message: t('userAccount.avatar.errors.networkError') });
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError(t('auth:login.errors.requiredFields'));
      return;
    }

    if (isRegisterMode) {
      if (password !== confirmPassword) {
        setError(t('auth:register.errors.passwordMismatch'));
        return;
      }

      if (username.trim().length < 3) {
        setError(t('auth:register.errors.usernameLength'));
        return;
      }

      if (isEmailLikeUsername(username)) {
        setError(t('auth:register.errors.usernameEmail'));
        return;
      }

      if (password.length < 6) {
        setError(t('auth:register.errors.passwordLength'));
        return;
      }

      if (!EMAIL_REGEX.test(notificationEmail.trim())) {
        setError(t('auth:register.errors.invalidEmail'));
        return;
      }

      if (!legalAccepted) {
        setError(t('auth:register.legalAgreement.required'));
        return;
      }
    }

    setIsLoading(true);

    const result = isRegisterMode
      ? await register(
        username.trim(),
        password,
        notificationEmail.trim(),
        legalAccepted,
      )
      : await login(username.trim(), password);

    if (!result.success) {
      setError(result.code === 'DEVICE_LIMIT_REACHED' ? t('auth:login.errors.deviceLimitReached') : result.error);
      setIsLoading(false);
      return;
    }

    resetForm();
    setMode('login');
    setShowAuthForm(false);
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setProfileStatus(null);

    const nextEmail = profileDraft.notificationEmail.trim();
    if (!nextEmail || !EMAIL_REGEX.test(nextEmail)) {
      setProfileStatus({ success: false, message: t('userAccount.profile.errors.invalidEmail') });
      return;
    }

    setProfileLoading(true);

    try {
      const response = await api.user.updateProfile({
        ...profileDraft,
        notificationEmail: nextEmail,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setProfileStatus({
          success: false,
          message: data?.error || t('userAccount.profile.errors.saveFailed'),
        });
        return;
      }

      setProfileDraft(buildProfileDraft(data?.profile || profileDraft));
      await refreshUser?.();
      setProfileStatus({ success: true, message: t('userAccount.profile.saved') });
      setShowProfileForm(false);
    } catch (profileError) {
      console.error('Profile update error:', profileError);
      setProfileStatus({ success: false, message: t('userAccount.profile.errors.networkError') });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setPasswordStatus(null);

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.requiredFields') });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.passwordLength') });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.passwordMismatch') });
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await api.user.changePassword(currentPassword, newPassword);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setPasswordStatus({
          success: false,
          message: getPasswordErrorMessage(data?.error),
        });
        return;
      }

      resetPasswordForm();
      setPasswordStatus({ success: true, message: t('userAccount.password.success') });
      setShowPasswordForm(false);
    } catch (changeError) {
      console.error('Password update error:', changeError);
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.networkError') });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 pl-1 md:pl-2">
        <div className="flex items-center gap-3">
          <LogIn className="h-4 w-4 flex-none text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="whitespace-nowrap text-lg font-semibold leading-tight text-foreground">
              {t('userAccount.title')}
            </h3>
            <p className="max-w-full text-sm text-muted-foreground">
              {t('userAccount.description')}
            </p>
          </div>
          <span className="ml-auto inline-flex items-center rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {user ? t('userAccount.status.loggedIn') : t('userAccount.status.loggedOut')}
          </span>
        </div>
      </div>

      {user && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40 md:p-5">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <button
                type="button"
                onClick={() => setShowAvatarPicker((value) => !value)}
                className={`rounded-full transition focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
                  showAvatarPicker ? 'ring-2 ring-cyan-500/40' : 'hover:opacity-85'
                }`}
                aria-label={t('userAccount.avatar.currentLabel', { username: displayName })}
                aria-expanded={showAvatarPicker}
              >
                <UserAvatar
                  avatarId={selectedAvatarId || user?.avatarId}
                  avatarUrl={selectedAvatarUrl || user?.avatarUrl}
                  seed={displayName}
                  size={64}
                  label={t('userAccount.avatar.currentLabel', { username: displayName })}
                  decorative
                />
              </button>
              <div className="min-w-0 space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                  {t('userAccount.currentAccount')}
                </div>
                <div className="truncate text-base font-semibold text-foreground">{displayName}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {email || t('userAccount.noNotificationEmail')}
                </div>
                <p className="pt-1 text-sm text-muted-foreground">
                  {t('userAccount.switchHint')}
                </p>
                <button
                  type="button"
                  onClick={handleToggleProfileForm}
                  disabled={profileLoading}
                  aria-expanded={showProfileForm}
                  className={`inline-flex w-fit items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    showProfileForm
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50'
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  {t('userAccount.profile.actions.edit')}
                </button>
              </div>
            </div>

            <div className="flex flex-row flex-wrap gap-2 md:w-auto md:flex-none md:flex-nowrap md:justify-end">
              <button
                type="button"
                onClick={handleTogglePasswordForm}
                disabled={passwordLoading}
                aria-expanded={showPasswordForm}
                className={`inline-flex w-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  showPasswordForm
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50'
                    : 'border-border bg-background text-foreground hover:bg-accent'
                }`}
              >
                <LockKeyhole className="h-3.5 w-3.5" />
                {t('userAccount.password.title')}
              </button>
              <button
                type="button"
                onClick={handleToggleSwitchAccount}
                disabled={passwordLoading}
                className="inline-flex w-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {t('userAccount.actions.switchAccount')}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={passwordLoading}
                className="inline-flex w-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t('userAccount.actions.logout')}
              </button>
            </div>
          </div>

          {profileStatus && (
            <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              profileStatus.success
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
            }`}>
              {profileStatus.message}
            </div>
          )}

          {showProfileForm && (
            <form onSubmit={handleSaveProfile} className="mt-5 space-y-5 border-t border-border/70 pt-5">
              <div className="rounded-xl border border-emerald-200/40 bg-emerald-50/20 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/10">
                <div className="mb-4 flex items-center justify-between border-b border-emerald-200/40 pb-3 dark:border-emerald-900/30">
                  <h5 className="text-sm font-semibold text-foreground">
                    {t('userAccount.profile.sections.account')}
                  </h5>
                  <span className="text-xs text-muted-foreground">
                    {t('userAccount.profile.badges.loginIdentity')}
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {ACCOUNT_PROFILE_FIELDS.map((field) => (
                    <div
                      key={field.key}
                      className={field.key === 'notificationEmail' ? 'md:col-span-2' : ''}
                    >
                      <label htmlFor={`settings-profile-${field.key}`} className="mb-1 block text-sm font-medium text-muted-foreground">
                        {t(`userAccount.profile.fields.${field.key}`)}
                      </label>
                      <input
                        id={`settings-profile-${field.key}`}
                        type={field.type || 'text'}
                        autoComplete={field.key === 'notificationEmail' ? 'email' : 'off'}
                        value={profileDraft[field.key]}
                        onChange={(event) => handleProfileFieldChange(field.key, event.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder={t(`userAccount.profile.placeholders.${field.key}`)}
                        disabled={profileLoading}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200/40 bg-emerald-50/20 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/10">
                <div className="mb-4 flex items-center justify-between border-b border-emerald-200/40 pb-3 dark:border-emerald-900/30">
                  <h5 className="text-sm font-semibold text-foreground">
                    {t('userAccount.profile.sections.research')}
                  </h5>
                  <span className="text-xs text-muted-foreground">
                    {t('userAccount.profile.badges.optional')}
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {RESEARCH_PROFILE_FIELDS.map((field) => (
                    <div key={field.key}>
                      <label htmlFor={`settings-profile-${field.key}`} className="mb-1 block text-sm font-medium text-muted-foreground">
                        {t(`userAccount.profile.fields.${field.key}`)}
                      </label>
                      <input
                        id={`settings-profile-${field.key}`}
                        type="text"
                        value={profileDraft[field.key]}
                        onChange={(event) => handleProfileFieldChange(field.key, event.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder={t(`userAccount.profile.placeholders.${field.key}`)}
                        disabled={profileLoading}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200/40 bg-emerald-50/20 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/10">
                <div className="mb-4 flex items-center justify-between border-b border-emerald-200/40 pb-3 dark:border-emerald-900/30">
                  <h5 className="text-sm font-semibold text-foreground">
                    {t('userAccount.profile.aboutYou.title')}
                  </h5>
                  <span className="text-xs text-muted-foreground">
                    {t('userAccount.profile.badges.optional')}
                  </span>
                </div>
                <label htmlFor="settings-about-you" className="mb-2 block text-sm font-medium text-muted-foreground">
                  {t('userAccount.profile.aboutYou.label')}
                </label>
                <textarea
                  id="settings-about-you"
                  value={profileDraft.aboutYou}
                  onChange={(event) => handleProfileFieldChange('aboutYou', event.target.value)}
                  rows={5}
                  maxLength={1200}
                  className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  placeholder={t('userAccount.profile.aboutYou.placeholder')}
                  disabled={profileLoading}
                />
                <div className="mt-2 text-right text-xs text-muted-foreground">
                  {t('userAccount.profile.aboutYou.counter', { count: profileDraft.aboutYou.length, max: 1200 })}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="submit"
                  disabled={profileLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-400 sm:min-w-[120px]"
                >
                  {profileLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {profileLoading ? t('userAccount.profile.actions.saving') : t('userAccount.profile.actions.save')}
                </button>
                <button
                  type="button"
                  onClick={handleResetProfileForm}
                  disabled={profileLoading}
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[96px]"
                >
                  {t('userAccount.profile.actions.reset')}
                </button>
                <button
                  type="button"
                  onClick={handleCancelProfileEdit}
                  disabled={profileLoading}
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[96px]"
                >
                  {t('actions.cancelChanges')}
                </button>
              </div>
            </form>
          )}

          {passwordStatus && (
            <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              passwordStatus.success
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
            }`}>
              {passwordStatus.message}
            </div>
          )}

          {showPasswordForm && (
            <div className="mt-4 border-t border-border/70 pt-4">
              <p className="text-sm text-muted-foreground">{t('userAccount.password.description')}</p>
              <form onSubmit={handleChangePassword} className="mt-4 grid gap-4 md:grid-cols-2 md:items-end">
                <div>
                  <label htmlFor="settings-current-password" className="mb-1 block text-sm font-medium text-foreground">
                    {t('userAccount.password.current')}
                  </label>
                  <input
                    id="settings-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder={t('userAccount.password.placeholders.current')}
                    disabled={passwordLoading}
                  />
                </div>

                <div>
                  <label htmlFor="settings-new-password" className="mb-1 block text-sm font-medium text-foreground">
                    {t('userAccount.password.new')}
                  </label>
                  <input
                    id="settings-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder={t('userAccount.password.placeholders.new')}
                    disabled={passwordLoading}
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="settings-confirm-new-password" className="mb-1 block text-sm font-medium text-foreground">
                    {t('userAccount.password.confirm')}
                  </label>
                  <input
                    id="settings-confirm-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder={t('userAccount.password.placeholders.confirm')}
                    disabled={passwordLoading}
                  />
                </div>

                <div className="flex flex-col gap-3 pt-1 md:col-span-2 sm:flex-row sm:items-center md:justify-start">
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400 sm:min-w-[120px]"
                  >
                    <LockKeyhole className="h-4 w-4" />
                    {passwordLoading ? t('userAccount.password.loading') : t('userAccount.password.submit')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelPasswordChange}
                    disabled={passwordLoading}
                    className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[120px]"
                  >
                    {t('actions.cancelChanges')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {(showAvatarPicker || avatarStatus) && (
            <div className="mt-5 border-t border-border/70 pt-5">
            {showAvatarPicker && (
              <div>
                <UserAvatarPicker
                  selectedAvatarId={selectedAvatarId || user?.avatarId}
                  avatarUrl={selectedAvatarUrl || user?.avatarUrl}
                  seed={displayName}
                  disabled={avatarLoading}
                  onSelect={handleSelectAvatar}
                  onUpload={handleUploadAvatar}
                />
              </div>
            )}

            {avatarStatus && (
              <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                avatarStatus.success
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
              }`}>
                {avatarStatus.message}
              </div>
            )}
            </div>
          )}

          <div className="mt-5 border-t border-border/70 pt-5">
            <ProjectActivityCalendar />
          </div>
        </div>
      )}

      <LocalKernelSettingsCard />

      {(!user || showAuthForm) && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-base font-semibold text-foreground">
                {isRegisterMode
                  ? t('auth:register.title')
                  : user
                    ? t('userAccount.switchFormTitle')
                    : t('auth:login.title')}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {isRegisterMode
                  ? t('auth:register.description')
                  : user
                    ? t('userAccount.switchFormDescription')
                    : t('auth:login.description')}
              </p>
            </div>

            <div className="inline-flex w-fit rounded-lg border border-border/70 bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  !isRegisterMode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('userAccount.mode.login')}
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isRegisterMode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('userAccount.mode.register')}
              </button>
            </div>
          </div>

          {user && !isRegisterMode && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300">
              {t('userAccount.replaceSessionHint')}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="settings-account-username" className="mb-1 block text-sm font-medium text-foreground">
                {isRegisterMode ? t('auth:register.username') : t('auth:login.username')}
              </label>
              <input
                id="settings-account-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder={
                  isRegisterMode
                    ? t('auth:register.placeholders.username')
                    : t('auth:login.placeholders.username')
                }
                disabled={isLoading}
              />
            </div>

            {isRegisterMode && (
              <div>
                <label htmlFor="settings-account-email" className="mb-1 block text-sm font-medium text-foreground">
                  {t('auth:register.email')}
                </label>
                <input
                  id="settings-account-email"
                  type="email"
                  autoComplete="email"
                  value={notificationEmail}
                  onChange={(event) => setNotificationEmail(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={t('auth:register.placeholders.email')}
                  disabled={isLoading}
                />
              </div>
            )}

            <div>
              <label htmlFor="settings-account-password" className="mb-1 block text-sm font-medium text-foreground">
                {isRegisterMode ? t('auth:register.password') : t('auth:login.password')}
              </label>
              <input
                id="settings-account-password"
                type="password"
                autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder={
                  isRegisterMode
                    ? t('auth:register.placeholders.password')
                    : t('auth:login.placeholders.password')
                }
                disabled={isLoading}
              />
            </div>

            {isRegisterMode && (
              <div>
                <label htmlFor="settings-account-confirm-password" className="mb-1 block text-sm font-medium text-foreground">
                  {t('auth:register.confirmPassword')}
                </label>
                <input
                  id="settings-account-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={t('auth:register.placeholders.confirmPassword')}
                  disabled={isLoading}
                />
              </div>
            )}

            {isRegisterMode && (
              <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm leading-6 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(event) => setLegalAccepted(event.target.checked)}
                  required
                  disabled={isLoading}
                  className="mt-1 h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
                />
                <span>
                  {t('auth:register.legalAgreement.label')}
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground/80">
                    {t('auth:register.legalAgreement.shortNotice')}
                  </span>
                  <details className="mt-2 text-xs leading-5 text-muted-foreground/80">
                    <summary className="cursor-pointer font-medium text-blue-600 dark:text-blue-300">
                      {t('auth:register.legalAgreement.detailsSummary')}
                    </summary>
                    <p className="mt-1">{t('auth:register.legalAgreement.detailsBody')}</p>
                  </details>
                </span>
              </label>
            )}

            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
              >
                {isRegisterMode ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                {isLoading
                  ? (isRegisterMode ? t('auth:register.loading') : t('auth:login.loading'))
                  : (isRegisterMode ? t('auth:register.submit') : t('auth:login.submit'))}
              </button>

              {user && (
                <button
                  type="button"
                  onClick={handleToggleSwitchAccount}
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  {t('actions.cancelChanges')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
