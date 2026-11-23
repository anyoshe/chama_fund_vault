/**
 * ChamaVault mark — plant growing from coins (clear at tab size + large in-app).
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
        <rect width="64" height="64" rx="14" fill="#0f172a" />
        {/* Coin stack — thick ellipses for small-size clarity */}
        <ellipse cx="32" cy="50" rx="20" ry="7" fill="#92400e" />
        <ellipse cx="32" cy="46" rx="20" ry="7" fill="#b45309" />
        <ellipse cx="32" cy="42" rx="20" ry="7" fill="#d97706" />
        <ellipse cx="32" cy="38" rx="20" ry="7" fill="#f59e0b" />
        <ellipse cx="32" cy="34" rx="20" ry="7" fill="#fbbf24" />
        <ellipse cx="32" cy="34" rx="13" ry="3.5" fill="#fde68a" />
        {/* Stem */}
        <path
          d="M32 34 V14"
          stroke="#059669"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Leaves — large silhouettes */}
        <path
          d="M32 26 C20 22 14 14 16 8 C28 10 32 18 32 26Z"
          fill="#34d399"
        />
        <path
          d="M32 24 C44 20 50 12 48 6 C36 8 32 16 32 24Z"
          fill="#10b981"
        />
        <path
          d="M32 20 C25 15 22 9 24 4 C30 6 32 12 32 20Z"
          fill="#6ee7b7"
        />
      </svg>
      {showWordmark && (
        <span className="text-lg font-bold tracking-tight text-white sm:text-xl">
          Chama<span className="text-emerald-400">Vault</span>
        </span>
      )}
    </span>
  );
}
