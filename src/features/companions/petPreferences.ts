export const PET_DIRECTORY_STORAGE_PREFIX = 'medhelp.companion.pet-directory.';

export function petDirectoryStorageKey(companionId: string) {
  return `${PET_DIRECTORY_STORAGE_PREFIX}${companionId}`;
}

export function getLocalPetDirectory(companionId: string) {
  try {
    return window.localStorage.getItem(petDirectoryStorageKey(companionId)) || '';
  } catch {
    return '';
  }
}

export function setLocalPetDirectory(companionId: string, directory: string) {
  const key = petDirectoryStorageKey(companionId);
  if (directory) window.localStorage.setItem(key, directory);
  else window.localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent('medhelp-pet-directory-changed', { detail: { companionId, directory } }));
}
