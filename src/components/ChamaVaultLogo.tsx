/**
 * ChamaVault mark — larger in-app logo (matches favicon artwork).
 */
export default function ChamaVaultLogo({
  size = 36,
  className = "",
  showWordmark = false,
}: {
  size?: number;
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className="shrink-0 drop-shadow-md"
        aria-hidden
      >
        <defs>
          <linearGradient id="cv-g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#34d399" />
            <stop offset="0.55" stopColor="#14b8a6" />
            <stop offset="1" stopColor="#0f766e" />
          </linearGradient>
          <linearGradient id="cv-gold" x1="20" y1="28" x2="44" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fbbf24" />
            <stop offset="1" stopColor="#d97706" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#cv-g)" />
        <rect x="16" y="18" width="32" height="30" rx="6" fill="#0f172a" opacity="0.35" />
        <rect x="18" y="20" width="28" height="26" rx="5" fill="#022c22" />
        <ellipse cx="32" cy="40" rx="10" ry="3.2" fill="url(#cv-gold)" />
        <ellipse cx="32" cy="36.5" rx="10" ry="3.2" fill="url(#cv-gold)" />
        <ellipse cx="32" cy="33" rx="10" ry="3.2" fill="url(#cv-gold)" />
        <ellipse cx="32" cy="29.5" rx="10" ry="3.2" fill="#fde68a" />
        <circle cx="32" cy="26" r="3.2" fill="#34d399" />
        <rect x="30.6" y="27.5" width="2.8" height="5.5" rx="1" fill="#34d399" />
        <circle cx="22" cy="22" r="2.2" fill="#a7f3d0" opacity="0.9" />
        <circle cx="32" cy="18.5" r="2.2" fill="#a7f3d0" opacity="0.9" />
        <circle cx="42" cy="22" r="2.2" fill="#a7f3d0" opacity="0.9" />
      </svg>
      {showWordmark && (
        <span className="text-lg font-bold tracking-tight text-white sm:text-xl">
          Chama<span className="text-emerald-400">Vault</span>
        </span>
      )}
    </span>
  );
}
