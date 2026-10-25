import { useRef } from 'preact/hooks';

export interface LogoMarkProps {
  size: number;
  mode: 'day' | 'night';
}

// Logo v2, "M on the sea at sunrise". All geometry is in a 100 x 100 box.
const M_PATH = 'M24 77 L24 32 L50 57 L76 32 L76 77';
const WAVES_CREST = 'M0 78 Q12.5 72 25 78 T50 78 T75 78 T100 78';
const WAVES_FILL = `${WAVES_CREST} V100 H0 Z`;
const SMALL_SIZE_MAX = 64;

let instances = 0;

/**
 * The Masterpiece logo as inline SVG. Day is a sunrise sky over a blue sea; night is a dark sky with a moon. At 64 px
 * and below the fine details (glow, horizon line, halo, small wave accents) are dropped and the M is thicker.
 * Gradient and clip ids are unique per instance, because several logos can be on one page.
 */
export function LogoMark({ size, mode }: LogoMarkProps) {
  const counter = useRef(0);
  if (counter.current === 0) counter.current = ++instances;
  const id = `logo-${counter.current}`;
  const small = size <= SMALL_SIZE_MAX;
  const night = mode === 'night';
  const mWidth = small ? 12 : 10;
  const crestWidth = small ? 3.5 : 2.5;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Masterpiece logo">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          {night ? (
            <>
              <stop offset="0" stop-color="#0B1622" />
              <stop offset="1" stop-color="#1E3550" />
            </>
          ) : (
            <>
              <stop offset="0" stop-color="#FFD23F" />
              <stop offset="0.35" stop-color="#FFE9A8" />
              <stop offset="0.7" stop-color="#D6EAFF" />
              <stop offset="1" stop-color="#9CCBFF" />
            </>
          )}
        </linearGradient>
        {!night && !small && (
          <radialGradient id={`${id}-glow`} cx="0.5" cy="0.2" r="0.5">
            <stop offset="0" stop-color="#FFF7D1" />
            <stop offset="0.4" stop-color="#FFE27A" stop-opacity="0.85" />
            <stop offset="1" stop-color="#FFE27A" stop-opacity="0" />
          </radialGradient>
        )}
        <clipPath id={`${id}-tile`}>
          <rect width="100" height="100" rx="22" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${id}-tile)`}>
        <rect width="100" height="62" fill={`url(#${id}-sky)`} />
        {!night && !small && <rect width="100" height="62" fill={`url(#${id}-glow)`} />}
        {night ? (
          <circle cx="50" cy="20" r="6" fill="#E6EDF5" opacity="0.85" />
        ) : (
          <circle cx="50" cy="20" r="7.5" fill="#FFF4C2" />
        )}
        <rect y="60" width="100" height="40" fill={night ? '#12243A' : '#2E6DB4'} />
        {!small && (
          <path d="M0 60 H100" stroke={night ? '#5FD4CE' : '#FFFFFF'} stroke-opacity={night ? 0.8 : 0.85} stroke-width="0.8" />
        )}
        {!night && !small && (
          <path d={M_PATH} fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="15" stroke-linejoin="round" stroke-linecap="round" />
        )}
        <path d={M_PATH} fill="none" stroke={night ? '#E6EDF5' : '#0B2545'} stroke-width={mWidth} stroke-linejoin="round" stroke-linecap="round" />
        <path d={WAVES_FILL} fill={night ? '#0E1B2B' : '#0B2545'} />
        <path d={WAVES_CREST} fill="none" stroke={night ? '#5FD4CE' : '#7AB8FF'} stroke-width={crestWidth} />
        {!night && !small && (
          <path d="M8 89 Q18 85 28 89 M58 91 Q68 87 78 91" fill="none" stroke="#1D5FD1" stroke-width="2" stroke-linecap="round" />
        )}
      </g>
    </svg>
  );
}
