type BrandProps = {
  compact?: boolean;
  inverse?: boolean;
  iconOnly?: boolean;
  className?: string;
};

export function BrandMark({ className = "" }: { className?: string }) {
  return <svg className={`brand__mark ${className}`.trim()} viewBox="0 0 304 184" aria-hidden="true">
    <path className="brand__arch" d="M32 148v-30c0-44 27-67 60-67s60 23 60 67v30M152 148v-30c0-44 27-67 60-67s60 23 60 67v30"/>
    <circle className="brand__person" cx="152" cy="24" r="22"/>
  </svg>;
}

export function Brand({ compact = false, inverse = false, iconOnly = false, className = "" }: BrandProps) {
  const classes = ["brand", compact && "brand--compact", inverse && "brand--inverse", iconOnly && "brand--icon", className].filter(Boolean).join(" ");
  return <span className={classes} aria-label="mittragen.ch">
    <BrandMark/>
    {!iconOnly && <span className="brand__word"><span>mittragen</span><span className="brand__ch">.ch</span></span>}
  </span>;
}
