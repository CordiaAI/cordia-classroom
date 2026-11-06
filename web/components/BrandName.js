// The name beside the mark: the "cordia" wordmark (public/cordia-wordmark.webp, the brand file as
// given) followed by "classroom" in the site's font. `compact` drops "classroom".
export default function BrandName({ compact = false }) {
  return (
    <span className="c-brandname" role="img" aria-label={compact ? 'Cordia' : 'Cordia Classroom'}>
      <img className="c-brandname-mark" src="/cordia-wordmark.webp" alt="" aria-hidden="true" />
      {!compact && <span className="c-brandname-product" aria-hidden="true">classroom</span>}
    </span>
  );
}
