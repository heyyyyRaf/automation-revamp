/** Icons drawn in the Traxion QA design (stroke icons, 24-unit grid, currentColor). */
import type * as React from "react";

type P = React.SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, strokeWidth = 2, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: P) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M5 12l4 4 10-10" />
  </Svg>
);
export const ProjectsIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);
export const CodeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
  </Svg>
);
export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 3l14 9-14 9V3z" />
  </Svg>
);
export const SettingsIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const ArrowRightIcon = (p: P) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M4 20h16" />
  </Svg>
);
export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </Svg>
);
export const DocumentIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </Svg>
);
export const FlowIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="16" width="7" height="5" rx="1.5" />
    <path d="M6.5 8v4h11v4" />
  </Svg>
);
export const ScreenIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M3 9h18M8 21h8" />
  </Svg>
);
