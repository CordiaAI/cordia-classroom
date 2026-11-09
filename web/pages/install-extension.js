import UseCasePage from '../components/UseCasePage';
import page from '../lib/useCases/installExtension.mjs';

// The Chrome extension: what it reads, how to open it, permissions and sign-in. The copy lives in
// lib/useCases/; the URL stays /install-extension because AI answers already cite it.
export default function InstallExtension() {
  return <UseCasePage page={page} />;
}
