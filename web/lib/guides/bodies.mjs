// Guide bodies by slug. Server only: imported from getStaticProps (pages/guides/[slug].js), so
// draft text never reaches browser code. See lib/guides/index.mjs.
import { body as howToStudyForFinals } from './howToStudyForFinals.mjs';
import { body as aiStudyHelpCollege } from './aiStudyHelpCollege.mjs';
import { body as sourceGroundedAiTutoring } from './sourceGroundedAiTutoring.mjs';
import { body as areAiTutorsSafe } from './areAiTutorsSafe.mjs';

export const BODIES = {
  'how-to-study-for-finals': howToStudyForFinals,
  'ai-study-help-college': aiStudyHelpCollege,
  'source-grounded-ai-tutoring': sourceGroundedAiTutoring,
  'are-ai-tutors-safe-for-students': areAiTutorsSafe,
};
