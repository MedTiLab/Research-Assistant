import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api, authenticatedFetch } from '../../utils/api';

const EMAIL_SETTINGS_MESSAGE_KEYS = {
  'Failed to load email settings': 'emailSettings.status.loadFailed',
  'Notification email is required': 'emailSettings.status.notificationEmailRequired',
  'Invalid email format': 'emailSettings.status.invalidEmailFormat',
  'Failed to update user profile': 'emailSettings.status.notificationEmailSaveFailed',
  'Failed to save notification email': 'emailSettings.status.notificationEmailSaveFailed',
  'Sender email is required': 'emailSettings.status.senderEmailRequired',
  'Failed to fetch Auto Research sender email': 'emailSettings.status.senderEmailLoadFailed',
  'Failed to save Auto Research sender email': 'emailSettings.status.senderEmailSaveFailed',
  'Failed to save sender email': 'emailSettings.status.senderEmailSaveFailed',
};

const resolveStatusMessage = (t, message, fallbackKey) => {
  if (typeof message !== 'string' || !message.trim()) {
    return t(fallbackKey);
  }

  const translatedKey = EMAIL_SETTINGS_MESSAGE_KEYS[message];
  return translatedKey ? t(translatedKey) : message;
};

export default function EmailSettingsContent({ embedded = false }) {
  const { t } = useTranslation('settings');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [profileStatus, setProfileStatus] = useState(null);
  const [senderStatus, setSenderStatus] = useState(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingSender, setIsSavingSender] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const [profileRes, senderRes] = await Promise.all([
          authenticatedFetch('/api/user/profile'),
          api.settings.autoResearchEmail(),
        ]);

        const profileData = await profileRes.json();
        const senderData = await senderRes.json();

        if (!cancelled && profileRes.ok) {
          setNotificationEmail(profileData?.profile?.notificationEmail || '');
        }
        if (!cancelled && senderRes.ok) {
          setSenderEmail(senderData?.senderEmail || '');
        }
      } catch (err) {
        if (!cancelled) {
          setProfileStatus({
            success: false,
            message: resolveStatusMessage(t, err.message, 'emailSettings.status.loadFailed'),
          });
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setProfileStatus(null);
    try {
      const res = await authenticatedFetch('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ notificationEmail: notificationEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotificationEmail(data?.profile?.notificationEmail || notificationEmail.trim());
        setProfileStatus({ success: true, message: t('emailSettings.status.notificationEmailSaved') });
      } else {
        setProfileStatus({
          success: false,
          message: resolveStatusMessage(t, data.error, 'emailSettings.status.notificationEmailSaveFailed'),
        });
      }
    } catch (err) {
      setProfileStatus({
        success: false,
        message: resolveStatusMessage(t, err.message, 'emailSettings.status.notificationEmailSaveFailed'),
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveSenderEmail = async () => {
    setIsSavingSender(true);
    setSenderStatus(null);
    try {
      const res = await api.settings.updateAutoResearchEmail(senderEmail.trim());
      const data = await res.json();
      if (res.ok) {
        setSenderEmail(data?.senderEmail || senderEmail.trim());
        setSenderStatus({ success: true, message: t('emailSettings.status.senderEmailSaved') });
      } else {
        setSenderStatus({
          success: false,
          message: resolveStatusMessage(t, data.error, 'emailSettings.status.senderEmailSaveFailed'),
        });
      }
    } catch (err) {
      setSenderStatus({
        success: false,
        message: resolveStatusMessage(t, err.message, 'emailSettings.status.senderEmailSaveFailed'),
      });
    } finally {
      setIsSavingSender(false);
    }
  };

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h3 className="text-lg font-medium text-foreground">{t('emailSettings.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('emailSettings.description')}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4 text-gray-500" />
          <div className="font-medium text-foreground">{t('emailSettings.notificationEmail.title')}</div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-muted-foreground block mb-1">{t('emailSettings.notificationEmail.label')}</label>
            <Input
              type="email"
              placeholder={t('emailSettings.notificationEmail.placeholder')}
              value={notificationEmail}
              onChange={(e) => setNotificationEmail(e.target.value)}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              {t('emailSettings.notificationEmail.help')}
            </div>
          </div>
          <Button onClick={handleSaveProfile} disabled={isSavingProfile || !notificationEmail.trim()} size="sm" variant="outline">
            {isSavingProfile ? t('emailSettings.actions.saving') : t('emailSettings.actions.saveNotificationEmail')}
          </Button>
          {profileStatus && (
            <div className={`text-sm ${profileStatus.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {profileStatus.message}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4 text-gray-500" />
          <div className="font-medium text-foreground">{t('emailSettings.senderEmail.title')}</div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-muted-foreground block mb-1">{t('emailSettings.senderEmail.label')}</label>
            <Input
              type="email"
              placeholder={t('emailSettings.senderEmail.placeholder')}
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              {t('emailSettings.senderEmail.help')}
            </div>
          </div>
          <Button onClick={handleSaveSenderEmail} disabled={isSavingSender || !senderEmail.trim()} size="sm" variant="outline">
            {isSavingSender ? t('emailSettings.actions.saving') : t('emailSettings.actions.saveSenderEmail')}
          </Button>
          {senderStatus && (
            <div className={`text-sm ${senderStatus.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {senderStatus.message}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
