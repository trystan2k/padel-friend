const paths = {
  back: 'M19 12H5m7-7-7 7 7 7',
  refresh: 'M20 7v5h-5M4 17v-5h5m11 0a8 8 0 0 0-14-5m-2 5a8 8 0 0 0 14 5',
  warning: 'M12 5v9m0 4v1',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  play: 'M8 5v14l11-7Z',
  failed: 'm6 6 12 12M6 18 18 6'
} as const;

export type RepairIconName = keyof typeof paths;

export function RepairIcon({ name, size }: { name: RepairIconName; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
