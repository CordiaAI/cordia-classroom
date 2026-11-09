import UseCasePage from '../components/UseCasePage';
import page from '../lib/useCases/aiFlashcardMaker.mjs';

// Flashcards from a student's own study guide, spaced review and Learn. The copy lives in lib/useCases/.
export default function AiFlashcardMaker() {
  return <UseCasePage page={page} />;
}
