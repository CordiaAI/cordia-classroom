// The name beside the mark: the "cordia" wordmark (public/cordia-wordmark.webp, the brand file as given).
// The image carries its own alt text, so crawlers that check every <img> for alt don't flag it.
export default function BrandName() {
  return (
    <span className="c-brandname">
      <img className="c-brandname-mark" src="/cordia-wordmark.webp" alt="Cordia" />
    </span>
  );
}
