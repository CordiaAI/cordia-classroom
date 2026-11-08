import UseCasePage from '../components/UseCasePage';
import page from '../lib/useCases/aiStudyGuideGenerator.mjs';

// Turning lecture slides and PDFs into study guides. The copy lives in lib/useCases/.
export default function AiStudyGuideGenerator() {
  return <UseCasePage page={page} />;
}
