// Draft: /guides/are-ai-tutors-safe-for-students. Cordia privacy statements follow
// web/pages/privacy.js as merged in PR 240 (Last Updated November 8, 2026) and the code (uploads:
// backend/routers/materials.py; sharing: backend/routers/guides.py, web/components/VisibilityChip.js);
// the Honor Code and instructor steps follow web/pages/honor-code.js and web/pages/instructors.js.
import { AUTHOR } from './author.mjs';

export default {
  slug: 'are-ai-tutors-safe-for-students',
  title: 'Is it safe for students to use AI tutors that use their class materials?',
  topic: 'Are AI Tutors Safe for Students?',
  crumb: 'Are AI tutors safe for students?',
  description: 'What to check before you give an AI tutor your class materials: who stores and processes your files, how to verify answers, and where integrity lines are.',
  author: AUTHOR,
  datePublished: '2026-11-09',
  dateModified: '2026-11-09',
  draft: true,
  sources: [
    { title: 'Cordia Classroom Privacy Policy (Last Updated November 8, 2026)', url: 'https://classroom.cordiaai.io/privacy', supports: 'What Cordia stores, which providers process it, no advertising use or sale, account deletion and backups, and the Chrome extension\'s data practices.' },
    { title: 'Cordia Classroom Honor Code', url: 'https://classroom.cordiaai.io/honor-code', supports: 'Study aid, not submitted work; no use in closed-book or proctored exams unless permitted; AI content may contain errors.' },
    { title: 'Cordia Classroom for instructors', url: 'https://classroom.cordiaai.io/instructors', supports: 'How an instructor turns sharing off for a course they teach.' },
    { title: 'U.S. Department of Education, "What is FERPA?"', url: 'https://studentprivacy.ed.gov/faq/what-ferpa', supports: 'FERPA rights over education records transfer from parents to the student on entering a postsecondary institution.' },
    { title: 'Ji et al. (2023), "Survey of Hallucination in Natural Language Generation", ACM Computing Surveys 55(12)', url: 'https://doi.org/10.1145/3571730', supports: 'Language generation models are prone to producing unsupported text ("hallucination").' },
    { title: 'Shuster et al. (2021), "Retrieval Augmentation Reduces Hallucination in Conversation", arXiv:2104.07567', url: 'https://arxiv.org/abs/2104.07567', supports: 'Grounding answers in retrieved text substantially reduced hallucination in chatbots.' },
  ],
  related: ['/guides/source-grounded-ai-tutoring', '/guides/ai-study-help-college', '/install-extension', '/canvas-study-tool'],
};

export const body = `
Yes, it can be safe, if you check three things first: who stores and processes your files, how you can verify the tutor's answers, and whether your use stays a study aid rather than work you hand in. A tool that is clear on all three, and lets you delete what you upload, is a reasonable choice; a tool that is vague on any of them deserves more caution.

Your lecture slides and notes are usually not sensitive in themselves, but your account, your questions and the way you use the answers can be. The rest of this guide goes through each check, then gives a table you can use on any AI study tool.

## What happens to my class materials when I upload them?

It depends entirely on the tool, so read its privacy policy before you upload. Look for plain answers to four questions: what is stored, for how long, which other companies process it, and whether it is used for anything besides your studying.

As an example of what those answers look like, here is how Cordia handles them, from its privacy policy and its code:

- **What's stored.** The study guides, notes and flashcards you make are stored with your account. A file you upload to make a guide is read into text, and the file itself isn't kept.
- **Who processes it.** The policy names each provider. Anthropic (Claude) writes study guides, questions, flashcards, notes and Tutor replies, and receives the material and questions you send for that; Supabase provides the database, file storage and sign-in. The policy says these providers "are contractually obligated to protect your data and may only use it to perform services on our behalf."
- **What it isn't used for.** The policy says: "We do not use your content or personal data for advertising purposes, and we do not sell your data to third parties."
- **Deleting it.** You can delete your account in Settings, and your study materials, notes, lectures and recordings are deleted immediately; copies in providers' encrypted backups expire within 30 days.

If a tool also has a browser extension, check when it reads pages. Cordia's extension reads page content only when you click Make study guide, choose Make study guide from selection, or ask the Tutor a question before you've made a guide.

<!-- PERSONAL EXAMPLE (Jude): what you learned about where uploaded files go while choosing Cordia's providers. -->

## Does my school's privacy law cover a study app I choose?

Don't assume it does. In the United States, the federal law on education records, FERPA, gives the rights over those records to you once you enter a postsecondary institution ([U.S. Department of Education](https://studentprivacy.ed.gov/faq/what-ferpa)). A study tool you sign up for on your own is a separate service with its own terms, so its privacy policy is the document that tells you what happens to your data there.

Two practical rules follow. Don't upload anything you wouldn't be comfortable having stored by a company, such as other students' personal information or graded work with names on it. And if your course has rules about sharing course materials outside the class, those rules apply to AI tools too.

## How do I know the AI's answers are accurate?

Assume they can be wrong and check the ones that matter. Language models are known to produce fluent text that isn't supported by any source, a problem researchers call hallucination ([Ji et al., 2023](https://doi.org/10.1145/3571730)).

Tools that answer from your own material, instead of from the model's general training, tend to make fewer of these errors: in one study, grounding chatbot answers in retrieved text substantially reduced hallucination ([Shuster et al., 2021](https://arxiv.org/abs/2104.07567)). That's why it helps when a tool shows which material an answer came from. The [guide to source-grounded AI tutoring](/guides/source-grounded-ai-tutoring) explains how that works and how to test a tool.

A quick routine for checking answers:

- Open the source the tool says it used and find the passage.
- Make sure the answer says what the passage says, and notice anything it adds.
- For anything you'll be graded on, check against your lecture notes or textbook.
- If the tool and your course disagree, go with your course and ask your instructor.

Cordia's Honor Code says the same thing in its own words: "AI-generated content may contain errors or inaccuracies."

## Where is the line between a study aid and cheating?

The line is what you hand in and when you use the tool. Using AI to explain a concept, quiz yourself or plan your revision is studying. Submitting what it wrote as your own work, or using it during an exam that doesn't allow it, is not.

Your institution's academic integrity policy decides the details, and individual instructors can set stricter rules for their course, so check both. Cordia's Honor Code sets out the same boundaries. It asks you to:

- "Comply with your institution's academic integrity policies at all times"
- "Not submit AI-generated content as your own original work on assignments, papers, or exams"
- "Not use Cordia Classroom during closed-book or proctored examinations unless explicitly permitted"
- "Verify important information with your course materials and authoritative sources"

<!-- PERSONAL EXAMPLE (Jude): a moment from your own studying where the line between help and doing the work was unclear, and how you decided. -->

## Can my instructor see or control how materials are shared?

In many tools, sharing is the risk: a study guide built from an instructor's slides and posted publicly can spread further than the instructor intended. Look for two things: whether what you make is private unless you choose to share it, and whether instructors have a way to turn sharing off.

In Cordia, guides you make start private. You can share one by choosing Link, Classroom or Public, and the first public or link share asks you to accept the Honor Code. Instructors can turn sharing off for a course they teach: they verify their school email and enter the course code, sets already shared become private, and no new ones can be shared. Students can still study with their own materials.

## What should I check before using any AI study tool?

Use this table on any tool you're considering, including Cordia. A good tool answers every row plainly in its privacy policy, help pages or settings.

| Check | Why it matters | A good answer looks like |
| --- | --- | --- |
| What is stored, and for how long | Your files and questions may stay on someone else's servers | A clear list of what's kept, and until when |
| Which companies process your data | AI tools often send your material to model providers | Named providers and what each one does |
| Whether your data is sold or used for ads | Study material can reveal a lot about you | A plain statement that it isn't |
| How to delete your account and data | You should be able to leave cleanly | Self-serve deletion, with backup timelines stated |
| Where answers come from | Answers built on your material are easier to verify | The tool shows which source an answer used |
| What happens when your material doesn't cover a question | Silent guessing is how wrong answers slip in | It says so, or labels anything extra |
| When an extension reads pages | Some extensions read everything you browse | Reads only when you ask it to |
| Default sharing settings | Public by default can expose your notes or your instructor's slides | Private unless you choose to share |
| Rules on academic integrity | You need to know where the tool draws the line | A clear policy that matches your school's |

## So, is it safe?

For most students, using an AI tutor with their own class materials is as safe as the tool's policies are clear. Pick a tool that tells you what it stores and who processes it, lets you delete your data, shows where its answers come from, and keeps your work private unless you share it. Then use it the way your course allows: to learn the material, not to replace the work you're graded on.

<!-- PERSONAL EXAMPLE (Jude): the one check from the table you'd tell a friend to do first, and why. -->
`;
