type PiLogoProps = {
  className?: string;
};

export default function PiLogo({ className = 'w-5 h-5' }: PiLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" fill="#7C3AED" />
      <path
        d="M7 8.2h10M9.3 8.2v7.2c0 1.2-.5 1.9-1.5 2.4M14.7 8.2v7.6c0 .9.4 1.5 1.3 1.8"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
