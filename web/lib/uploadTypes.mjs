// Every file type the upload boxes accept (New › Upload, the Tutor's attach button, Practice).
// It is the server's list, letter for letter (UPLOAD_TYPES in backend/services/file_extraction.py):
// tests/test_upload_types.py fails if the two ever differ, so change both together.
export const UPLOAD_TYPES = [
  // Documents and slides (.ppt is read through the server's LibreOffice).
  'pdf', 'docx', 'pptx', 'ppt',
  // Photos and scans; HEIC, BMP and TIFF are turned into JPEG on the server.
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff',
  // Notes, data and code, read as text.
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'tex', 'ipynb',
  'py', 'java', 'js', 'ts', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rb', 'php', 'swift', 'kt', 'rs', 'sql', 'r', 'm', 'sh',
];

// The file picker's accept attribute.
export const UPLOAD_ACCEPT = UPLOAD_TYPES.map(type => `.${type}`).join(',');

// Types that can't be read, with what to do instead (the server says the same: SAVE_AS).
const SAVE_AS = { doc: '.docx', rtf: '.docx', odt: '.docx', pages: 'PDF', key: 'PDF', numbers: 'PDF' };

export const extensionOf = name => (/\.([^./\\]+)$/.exec(name || '')?.[1] || '').toLowerCase();

// '' when the file can be uploaded, otherwise what to tell the student before any upload starts.
export function uploadTypeProblem(name) {
  const extension = extensionOf(name);
  if (UPLOAD_TYPES.includes(extension)) return '';
  const target = SAVE_AS[extension];
  if (target === 'PDF') return 'Export this as a PDF first, then upload it.';
  if (target) return `Save this as ${target} first, then upload it.`;
  return 'That file type is not supported yet. Try a PDF, slides, Word, image or text.';
}
