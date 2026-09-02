import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import { authSessionDb, projectActivityDb, projectDb, userDb } from '../database/db.js';
import { authenticateAccountToken, authenticateToken } from '../middleware/auth.js';
import { getSystemGitConfig } from '../utils/gitConfig.js';
import { resolveUserAvatarsDir } from '../utils/storagePaths.js';
import { getDefaultAvatarId, isValidAvatarId } from '../../shared/avatarCatalog.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = express.Router();
const AVATAR_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const USER_AVATAR_PUBLIC_PREFIX = '/user-avatars/';
const ANALYSIS_LANGUAGE_PREFERENCES = new Set(['auto', 'python', 'r']);
const PROFILE_TEXT_FIELDS = {
  displayName: { max: 80 },
  fullName: { max: 80 },
  institution: { max: 160 },
  organization: { max: 160 },
  academicTitle: { max: 120 },
  researchField: { max: 200 },
  usagePurpose: { max: 240 },
  googleScholarUrl: { max: 300 },
  websiteUrl: { max: 300 },
  orcid: { max: 64 },
  aboutYou: { max: 1200, preserveLines: true },
};

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: AVATAR_UPLOAD_LIMIT_BYTES,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    if (ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new Error('Unsupported avatar image type'));
  },
});

function toPublicProfile(profile) {
  if (!profile) return null;

  return {
    id: profile.id,
    username: profile.username,
    notificationEmail: profile.notification_email || null,
    displayName: profile.display_name || null,
    fullName: profile.full_name || null,
    institution: profile.institution || null,
    organization: profile.organization || null,
    academicTitle: profile.academic_title || null,
    researchField: profile.research_field || null,
    usagePurpose: profile.usage_purpose || null,
    googleScholarUrl: profile.google_scholar_url || null,
    websiteUrl: profile.website_url || null,
    orcid: profile.orcid || null,
    aboutYou: profile.about_you || null,
    analysisLanguagePreference: profile.analysis_language_preference || 'auto',
    avatarId: profile.avatar_id || getDefaultAvatarId(`${profile.id}:${profile.username}`),
    avatarUrl: profile.avatar_url || null,
  };
}

function normalizeOptionalProfileText(value, options) {
  const maxLength = options?.max || 200;
  const rawValue = typeof value === 'string' ? value.trim() : '';
  const normalized = options?.preserveLines
    ? rawValue.replace(/\r\n/g, '\n')
    : rawValue.replace(/\s+/g, ' ');

  if (normalized.length > maxLength) {
    return {
      error: `Profile field must be ${maxLength} characters or less`,
    };
  }

  return { value: normalized || null };
}

function avatarFilenameFromUrl(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith(USER_AVATAR_PUBLIC_PREFIX)) {
    return null;
  }

  const rawFilename = decodeURIComponent(avatarUrl.slice(USER_AVATAR_PUBLIC_PREFIX.length));
  const safeFilename = path.basename(rawFilename);
  return rawFilename === safeFilename ? safeFilename : null;
}

async function deleteUserAvatarFile(avatarUrl, exceptFilename = null) {
  const filename = avatarFilenameFromUrl(avatarUrl);
  if (!filename || filename === exceptFilename) {
    return;
  }

  try {
    await fs.unlink(path.join(resolveUserAvatarsDir(), filename));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to delete previous avatar:', error.message);
    }
  }
}

function normalizeProjectActivityText(value) {
  return String(value || '').trim();
}

router.get('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let gitConfig = userDb.getGitConfig(userId);

    // If database is empty, try to get from system git config
    if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
      const systemConfig = await getSystemGitConfig();

      // If system has values, save them to database for this user
      if (systemConfig.git_name || systemConfig.git_email) {
        userDb.updateGitConfig(userId, systemConfig.git_name, systemConfig.git_email);
        gitConfig = systemConfig;
        console.log(`Auto-populated git config from system for user ${userId}: ${systemConfig.git_name} <${systemConfig.git_email}>`);
      }
    }

    res.json({
      success: true,
      gitName: gitConfig?.git_name || null,
      gitEmail: gitConfig?.git_email || null
    });
  } catch (error) {
    console.error('Error getting git config:', error);
    res.status(500).json({ error: 'Failed to get git configuration' });
  }
});

// Apply git config globally via git config --global
router.post('/git-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { gitName, gitEmail } = req.body;

    if (!gitName || !gitEmail) {
      return res.status(400).json({ error: 'Git name and email are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(gitEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    userDb.updateGitConfig(userId, gitName, gitEmail);

    try {
      await execAsync(`git config --global user.name "${gitName.replace(/"/g, '\\"')}"`);
      await execAsync(`git config --global user.email "${gitEmail.replace(/"/g, '\\"')}"`);
      console.log(`Applied git config globally: ${gitName} <${gitEmail}>`);
    } catch (gitError) {
      console.error('Error applying git config:', gitError);
    }

    res.json({
      success: true,
      gitName,
      gitEmail
    });
  } catch (error) {
    console.error('Error updating git config:', error);
    res.status(500).json({ error: 'Failed to update git configuration' });
  }
});

router.post('/complete-onboarding', authenticateAccountToken, async (req, res) => {
  try {
    const userId = req.user.id;
    userDb.completeOnboarding(userId);

    res.json({
      success: true,
      message: 'Onboarding completed successfully'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

router.get('/profile', authenticateAccountToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const profile = userDb.getProfile(userId);

    res.json({
      success: true,
      profile: toPublicProfile(profile)
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

router.put('/profile', authenticateAccountToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const hasNotificationEmail = Object.prototype.hasOwnProperty.call(body, 'notificationEmail');
    const hasAvatarId = Object.prototype.hasOwnProperty.call(body, 'avatarId');
    const hasAnalysisLanguagePreference = Object.prototype.hasOwnProperty.call(body, 'analysisLanguagePreference');
    const hasProfileTextUpdate = Object.keys(PROFILE_TEXT_FIELDS)
      .some((key) => Object.prototype.hasOwnProperty.call(body, key));

    if (!hasNotificationEmail && !hasAvatarId && !hasAnalysisLanguagePreference && !hasProfileTextUpdate) {
      return res.status(400).json({ error: 'No profile updates provided' });
    }

    const updates = {};
    const previousProfile = hasAvatarId ? userDb.getProfile(userId) : null;

    if (hasNotificationEmail) {
      const rawEmail = typeof body.notificationEmail === 'string' ? body.notificationEmail.trim().toLowerCase() : '';

      if (!rawEmail) {
        return res.status(400).json({ error: 'Notification email is required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(rawEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      updates.notificationEmail = rawEmail;
    }

    if (hasAvatarId) {
      const avatarId = typeof body.avatarId === 'string' ? body.avatarId.trim() : '';
      if (!isValidAvatarId(avatarId)) {
        return res.status(400).json({ error: 'Invalid avatar selection' });
      }

      updates.avatarId = avatarId;
      updates.avatarUrl = null;
    }

    for (const [fieldName, fieldOptions] of Object.entries(PROFILE_TEXT_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(body, fieldName)) {
        const normalized = normalizeOptionalProfileText(body[fieldName], fieldOptions);
        if (normalized.error) {
          return res.status(400).json({ error: normalized.error });
        }
        updates[fieldName] = normalized.value;
      }
    }

    if (hasAnalysisLanguagePreference) {
      const languagePreference = typeof body.analysisLanguagePreference === 'string'
        ? body.analysisLanguagePreference.trim().toLowerCase()
        : 'auto';

      if (!ANALYSIS_LANGUAGE_PREFERENCES.has(languagePreference)) {
        return res.status(400).json({ error: 'Invalid analysis language preference' });
      }

      updates.analysisLanguagePreference = languagePreference;
    }

    const profile = userDb.updateProfile(userId, updates);

    if (hasAvatarId) {
      await deleteUserAvatarFile(previousProfile?.avatar_url);
    }

    res.json({
      success: true,
      profile: toPublicProfile(profile)
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

router.post('/avatar', authenticateAccountToken, (req, res) => {
  avatarUpload.single('avatar')(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Avatar image must be 5MB or smaller' });
      }

      return res.status(400).json({ error: uploadError.message || 'Invalid avatar upload' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Avatar image is required' });
    }

    try {
      const userId = req.user.id;
      const avatarDir = resolveUserAvatarsDir();
      await fs.mkdir(avatarDir, { recursive: true });

      const filename = `user-${userId}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webp`;
      const outputPath = path.join(avatarDir, filename);

      await sharp(req.file.buffer, { animated: false })
        .rotate()
        .resize(512, 512, { fit: 'cover', position: 'center' })
        .webp({ quality: 88 })
        .toFile(outputPath);

      const previousProfile = userDb.getProfile(userId);
      const avatarUrl = `${USER_AVATAR_PUBLIC_PREFIX}${filename}`;
      const profile = userDb.updateProfile(userId, { avatarUrl });
      await deleteUserAvatarFile(previousProfile?.avatar_url, filename);

      return res.json({
        success: true,
        profile: toPublicProfile(profile),
      });
    } catch (error) {
      console.error('Error uploading user avatar:', error);
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }
  });
});

router.get('/project-activity', authenticateToken, async (req, res) => {
  try {
    const days = Number.parseInt(req.query.days, 10) || 365;
    const timezoneOffsetMinutes = Number.parseInt(req.query.timezoneOffsetMinutes, 10) || 0;
    const activity = projectActivityDb.getActivity(req.user.id, {
      days,
      timezoneOffsetMinutes,
    });

    res.json({ activity });
  } catch (error) {
    console.error('Error reading project activity:', error);
    res.status(500).json({ error: 'Failed to read project activity' });
  }
});

router.post('/project-activity/open', authenticateToken, async (req, res) => {
  try {
    const projectId = normalizeProjectActivityText(
      req.body?.projectId || req.body?.projectName || req.body?.name,
    );
    if (!projectId) {
      return res.status(400).json({ error: 'Project id is required' });
    }

    const existingProject = projectDb.getProjectById(projectId);
    if (existingProject?.user_id != null && Number(existingProject.user_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const source = normalizeProjectActivityText(req.body?.source || 'project_select') || 'project_select';
    const event = projectActivityDb.recordProjectOpen(req.user.id, {
      projectId,
      projectPath: normalizeProjectActivityText(req.body?.projectPath || req.body?.path || req.body?.fullPath) || null,
      metadata: {
        source,
        displayName: normalizeProjectActivityText(req.body?.displayName) || null,
      },
    });

    res.json({ success: true, event });
  } catch (error) {
    console.error('Error recording project activity:', error);
    res.status(500).json({ error: 'Failed to record project activity' });
  }
});

router.post('/password', authenticateAccountToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = userDb.getUserAuthById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = userDb.updatePassword(userId, passwordHash);
    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    const revokedSessionIds = authSessionDb.revokeAllForUser(
      userId,
      'password-changed',
      req.authSessionId || null,
    );
    const revokedSet = new Set(revokedSessionIds.map(String));
    for (const client of req.app?.locals?.wss?.clients || []) {
      if (client?.authSessionId && revokedSet.has(String(client.authSessionId))) {
        client.close(4001, 'password-changed');
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

router.get('/onboarding-status', authenticateAccountToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const hasCompleted = userDb.hasCompletedOnboarding(userId);

    res.json({
      success: true,
      hasCompletedOnboarding: hasCompleted
    });
  } catch (error) {
    console.error('Error checking onboarding status:', error);
    res.status(500).json({ error: 'Failed to check onboarding status' });
  }
});

export default router;
