import UseCasePage from '../components/UseCasePage';
import page from '../lib/useCases/aiQuizGenerator.mjs';

// Practice quizzes from a student's own study guide (Learn's Test yourself). The copy lives in lib/useCases/.
export default function AiQuizGenerator() {
  return <UseCasePage page={page} />;
}
