/* The seedling from the prototype: grows once with a spring, then idles. Animation lives in globals.css (.sprout). */
const LEAF_S = "M0 0C-3-7-13-8-17-4C-14 2-6 4 0 0Z";
const RIB_S = "M-2-.5C-6-2-10-3-14-3.5";
const LEAF_L = "M0 0C-5-11-20-13-26-7C-22 3-9 6 0 0Z";
const RIB_L = "M-2-1C-9-4-16-5-22-6";

export function Sprout({ small = false }: { small?: boolean }) {
  return (
    <svg className={`sprout${small ? " sm" : ""}`} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="spHalo">
          <stop offset="0" style={{ stopColor: "var(--leaf1)", stopOpacity: 0.34 }} />
          <stop offset=".55" style={{ stopColor: "var(--leaf1)", stopOpacity: 0.1 }} />
          <stop offset="1" style={{ stopColor: "var(--leaf1)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="spLeaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--leaf1)" }} />
          <stop offset="1" style={{ stopColor: "var(--leaf2)" }} />
        </linearGradient>
        <linearGradient id="spStem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--leaf1)" }} />
          <stop offset="1" style={{ stopColor: "var(--leaf2)" }} />
        </linearGradient>
      </defs>
      <circle className="halo" cx="60" cy="56" r="54" fill="url(#spHalo)" />
      <circle className="orbit" cx="60" cy="56" r="44" />
      <g className="sat">
        <circle cx="60" cy="12" r="2" />
      </g>
      <g className="sat b">
        <circle cx="104" cy="56" r="1.3" />
      </g>
      <circle className="mote" cx="44" cy="62" r="1.2" />
      <circle className="mote m2" cx="78" cy="58" r="1" />
      <circle className="mote m3" cx="66" cy="44" r="1.1" />
      <circle className="mote m4" cx="52" cy="40" r=".9" />
      <ellipse className="ground" cx="60" cy="93" rx="17" ry="2.4" />
      <g className="plant">
        <path className="stem" d="M60 92C60 80 57 70 60 50" />
        <g transform="translate(59 74)">
          <path className="leaf l1" d={LEAF_S} />
          <path className="rib" d={RIB_S} />
        </g>
        <g transform="translate(59.5 68) scale(-1 1)">
          <path className="leaf l2" d={LEAF_S} />
          <path className="rib" d={RIB_S} />
        </g>
        <g transform="translate(60 51) rotate(14)">
          <path className="leaf l3" d={LEAF_L} />
          <path className="rib" d={RIB_L} />
        </g>
        <g transform="translate(60 51) scale(-1 1) rotate(22)">
          <path className="leaf l4" d={LEAF_L} />
          <path className="rib" d={RIB_L} />
        </g>
      </g>
    </svg>
  );
}
