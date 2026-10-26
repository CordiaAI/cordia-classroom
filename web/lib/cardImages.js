// Photos on flashcards: shrunk in the browser, stored by /api/card-image in the public
// "card-images" bucket, kept on the card as `image` (back) or `front_image` (front).
import { authHeaders } from './api';

const MAX_SIDE = 1600;
const SCREENSHOT_SIDE = 2000;

// Only photos Cordia stored, or the inline images older cards carry, are shown on a card.
export function isCardImage(url) {
  const value = String(url || '');
  return /^https:\/\/[a-z0-9.-]+\/storage\/v1\/object\/public\/card-images\/[a-z0-9-]+\/[a-z0-9-]+\.(jpg|png|webp|gif)$/i.test(value)
    || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value);
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That photo couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

// Phone photos are often 4000px and several MB: draw them at most 1600px on a side as JPEG.
// GIFs stay as they are so they keep moving; PNGs with see-through parts stay PNG.
async function shrink(file, maxSide = MAX_SIDE) {
  if (file.type === 'image/gif') return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That photo couldn't be read. Try a JPEG or PNG.");
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 900 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) {
    bitmap.close?.();
    return readAsDataUrl(file);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  const keepAlpha = file.type === 'image/png';
  if (!keepAlpha) {
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  if (keepAlpha) {
    const png = canvas.toDataURL('image/png');
    // About 2 MB as base64: a photo saved as PNG is better as JPEG (on white).
    if (png.length < 2.8e6) return png;
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL('image/jpeg', 0.85);
}

export async function uploadCardImage(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose a photo.');
  const image = await shrink(file);
  const response = await fetch('/api/card-image', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) throw new Error(data.detail || "The photo didn't upload. Try again.");
  return data.url;
}

// A screenshot or photo for feedback: a little larger (text stays readable), stored privately.
// Returns its storage path.
export async function uploadFeedbackImage(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose a screenshot or photo.');
  const image = await shrink(file, SCREENSHOT_SIDE);
  const response = await fetch('/api/feedback-attachment', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.path) throw new Error(data.detail || "The screenshot didn't upload. Try again.");
  return data.path;
}
