import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const LocalGpuLogo = ({ className = 'w-5 h-5' }) => {
  const { isDarkMode } = useTheme();
  const color = isDarkMode ? '#34d399' : '#059669';

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="5" y="5" width="14" height="14" rx="2" stroke={color} strokeWidth="1.8" />
      <rect x="8" y="8" width="8" height="8" rx="1" fill={color} opacity="0.25" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" fill={color} opacity="0.6" />
      <line x1="8" y1="2" x2="8" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="2" x2="12" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="2" x2="16" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="19" x2="8" y2="22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="19" x2="12" y2="22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="19" x2="16" y2="22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="8" x2="5" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="12" x2="5" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="16" x2="5" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="19" y1="8" x2="22" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="19" y1="12" x2="22" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="19" y1="16" x2="22" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};

export default LocalGpuLogo;
