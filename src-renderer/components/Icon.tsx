export type IconName =
  | "grid"
  | "settings"
  | "play"
  | "stop"
  | "arrow"
  | "check"
  | "shield"
  | "refresh"
  | "clock"
  | "close"
  | "activity"
  | "game"
  | "spark";

const paths: Record<IconName, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </>
  ),
  settings: (
    <>
      <path
        d="M9 3h6l.7 3 2.6 1.5 2.9-.8 3 5.2-2.2 2.2V17l-2.2 2.2-3-.8L14 20H8l-.7-3-2.6-1.5-2.9.8-2-4.4L2 9.7V7l3-.8L7.5 5Z"
        transform="translate(2 1) scale(.83)"
      />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none" />,
  stop: (
    <rect
      x="6"
      y="6"
      width="12"
      height="12"
      rx="2"
      fill="currentColor"
      stroke="none"
    />
  ),
  arrow: (
    <>
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  game: (
    <>
      <path d="M7 6h10c3 0 6 12 3 13-2 1-4-4-6-4h-4c-2 0-4 5-6 4C1 18 4 6 7 6Z" />
      <path d="M8 9v5m-2.5-2.5h5M16 10h.01M18 13h.01" />
    </>
  ),
  spark: <path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" />,
};

export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
