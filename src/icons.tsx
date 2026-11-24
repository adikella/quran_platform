// Один набор иконок на всё приложение: контур 1.7, сетка 24.

const PATHS = {
  today: "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z",
  mushaf: "M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13",
  journal: "M6 3.5h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6zM6 3.5v17M9.5 8H15M9.5 12H15M9.5 16H13",
  progress: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM9 14.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z",
  inbox: "M4 13.5 6.5 5h11L20 13.5V19H4zM4 13.5h4.5l1 2.5h5l1-2.5H20",
  group: "M9 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5M15.5 5.3a3 3 0 0 1 0 5.4M17 14.3c2.1.6 3.5 2.3 3.5 4.7",
  back: "M14.5 5.5 8 12l6.5 6.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={`icon icon-${name}`}>
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
