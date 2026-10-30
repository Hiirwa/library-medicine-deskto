/** The website's logo: the bar-chart-steps mark on the brand gradient, with the gradient wordmark. */
export function Logo({ size }: { size?: number }) {
  return (
    <span className="logo" style={size ? { width: size, height: size, fontSize: size * 0.48, borderRadius: size * 0.33 } : undefined} aria-hidden="true">
      <i className="bi bi-bar-chart-steps" />
    </span>
  );
}

export function Brand({ tag = 'Research Data Platform' }: { tag?: string }) {
  return (
    <span className="flex items-center gap-3">
      <Logo />
      <span className="brand-text">
        <span className="brand-name">Library Medicine</span>
        <span className="brand-tag">{tag}</span>
      </span>
    </span>
  );
}
