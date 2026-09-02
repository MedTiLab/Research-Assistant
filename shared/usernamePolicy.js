const USERNAME_EMAIL_ERROR = 'Username cannot be an email address';

function isEmailLikeUsername(value) {
  return String(value || '').trim().includes('@');
}

export {
  USERNAME_EMAIL_ERROR,
  isEmailLikeUsername,
};
