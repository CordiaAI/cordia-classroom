// /guides/source-grounded-ai-tutoring. Outside facts link to sources whose abstracts were
// read (listed in `sources`). The Cordia section matches backend/routers/chat.py,
// backend/services/llm.py (Tutor prompts), backend/services/guide_tutor.py and
// web/components/AIChatWidget.js; the PR lists the lines.
import { AUTHOR } from './author.mjs';

export default {
  slug: 'source-grounded-ai-tutoring',
  title: 'What is source-grounded AI tutoring?',
  topic: 'What Is Source-Grounded AI Tutoring?',
  crumb: 'Source-grounded AI tutoring',
  description: 'Source-grounded AI tutoring answers from your own course material instead of the open web. How it works, why it cuts made-up answers, and how to check a tool.',
  author: AUTHOR,
  datePublished: '2026-11-11',
  dateModified: '2026-11-11',
  draft: false,
  sources: [
    { title: 'Lewis et al. (2020), "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", arXiv:2005.11401', url: 'https://arxiv.org/abs/2005.11401', supports: 'Defines retrieval-augmented generation; RAG models produced more specific and factual language than a model answering from its parameters alone.' },
    { title: 'Shuster et al. (2021), "Retrieval Augmentation Reduces Hallucination in Conversation", arXiv:2104.07567', url: 'https://arxiv.org/abs/2104.07567', supports: 'Retrieval in the loop substantially reduced knowledge hallucination in chatbots, by human evaluation.' },
    { title: 'Ji et al. (2023), "Survey of Hallucination in Natural Language Generation", ACM Computing Surveys 55(12)', url: 'https://doi.org/10.1145/3571730', supports: 'Language generation models are prone to "hallucinate unintended text", a known and widely studied problem.' },
  ],
  related: ['/guides/are-ai-tutors-safe-for-students', '/guides/ai-study-help-college', '/ai-study-guide-generator', '/install-extension'],
};

export const body = `
Source-grounded AI tutoring is AI help that answers from material you choose (your lecture slides, notes, readings or a study guide) instead of from whatever the model picked up in training. The tutor looks things up in that material and builds its answer on what it finds, so you can check each answer against the page it came from.

For a student, the difference matters most when the course defines something its own way, or when a general answer would be close but not what your professor taught. A grounded tutor is meant to give you your course's version.

## How is it different from a general chatbot?

A general chatbot answers from patterns it learned from a huge amount of text during training. It has no idea what your professor said in week six, which edition of the textbook you use, or how your course defines a term. When it doesn't know, it can still produce a fluent answer that sounds right.

A grounded tutor starts from a specific source. You give it the material, or it reads the page you have open, and it is instructed to treat that material as the authority. The table sums up the difference.

| Question | General chatbot | Source-grounded tutor |
| --- | --- | --- |
| Where do answers come from? | What the model learned in training | The material you give it, retrieved for each question |
| Does it know your course's definitions? | Only if they match common usage | Yes, if they are in the material |
| Can you check an answer? | Only against other sources you find yourself | Against the source it used |
| What happens when the answer isn't there? | It often answers anyway | A well-built tool says so, or labels anything it adds |

I asked a general chatbot to define a term from my business class, and it gave a perfectly good textbook answer that wasn't how my professor defined it. I only caught it because it didn't match the wording on the slides. On an exam, the professor's version is the one that gets graded. That's the whole reason Cordia's Tutor answers from your actual course materials first.

## Why does grounding reduce made-up answers?

Because the model has the relevant text in front of it instead of reconstructing it from memory. Language models are known to "hallucinate", producing text that sounds plausible but isn't supported, and a large research survey describes this as a widespread problem across summarizing, answering questions and dialogue ([Ji et al., 2023](https://doi.org/10.1145/3571730)).

The technique behind most grounded tools is called **retrieval-augmented generation**, or RAG. In plain words: before answering, the system searches a body of documents for the passages most relevant to your question, then hands those passages to the language model along with the question. The researchers who named the approach found that models working this way produced more specific and more factual language than the same kind of model answering from its training alone ([Lewis et al., 2020](https://arxiv.org/abs/2005.11401)).

Follow-up work tested the idea on chatbots specifically. Adding retrieval to conversational models substantially reduced the knowledge hallucination that human judges found in their answers ([Shuster et al., 2021](https://arxiv.org/abs/2104.07567)).

For studying, the source doesn't have to be a large search index. It can simply be your own notes or study guide, given to the model with your question. The principle is the same: the answer is built on text you can see.

## How can I check that a tool is really grounded?

Test it the way you would test a classmate who says they did the reading.

- **Ask about something you know isn't in your material.** A grounded tool should say the material doesn't cover it, or clearly label anything it adds from general knowledge.
- **Ask where the answer came from.** Look for a link, a quote or a named source you can open and compare.
- **Ask about a definition your course uses differently.** Check that the answer matches your notes, not the textbook-standard version.
- **Give it a wrong premise.** Ask "why does X cause Y?" when your notes say it doesn't. A grounded tool should correct you from the source rather than invent a reason.
- **Read its documentation.** Look for plain statements about whether it searches the web, which material it reads, and how much of a long document it can take in.

I threw a lot at Cordia's Tutor while building it. I asked it questions that were answered in the guide, questions that weren't in the guide at all, and trick questions with a wrong premise to see if it would just go along. The biggest catch was that when an answer wasn't in the material, it would sometimes answer from general knowledge without saying so. A student couldn't tell what came from their class and what didn't, so we fixed that.

## What are the limits of source-grounded tutoring?

Grounding makes answers easier to check; it doesn't make them automatically right.

- **The source can be wrong or incomplete.** If your notes are missing a step, a grounded tutor will be missing it too.
- **Retrieval can miss.** If the system pulls the wrong passage, or none, the answer is built on the wrong text.
- **Long material may be cut.** Every model has a limit on how much text it can read at once, so a very long document may be shortened before the model sees it.
- **The model can still misread.** Having the right passage in front of it lowers the chance of a made-up answer, but it can still misunderstand or summarize badly.
- **Some help goes beyond the source on purpose.** Explaining a concept often needs an analogy or a definition the notes don't include. That can be useful, as long as the tool tells you which part is extra.

So treat a grounded answer as a strong lead, then check the parts that matter against the source, especially before an exam. The check is quick when the tool tells you where to look: open the page, find the passage, and make sure the answer says what the passage says, no more and no less. If it adds something, decide whether you trust that part enough to study it, or ask your instructor.

## How does Cordia's Tutor use my own material?

Cordia's Tutor answers from the material you pick: one of your study guides or notes, files you attach (up to five), or the page the Cordia Chrome extension read. Whatever material is on screen is picked automatically, and you can switch to another.

Its instructions treat that material as the authority for what the course teaches. It can use reliable general knowledge to clarify a definition, a mechanism or a step of reasoning, or to give an analogy, but it is told not to contradict the source and to say clearly when extra context goes beyond what your guide states. Each reply names the material it was based on, and for a guide, a note or a captured page you can open that material from the reply to check it.

A few more details, as the Tutor works today:

- **It doesn't search the web.** Cordia uses the material you added, not search results.
- **It reads up to 25,000 characters of the selected material**, so with a very long document, the end may not be included.
- **With no material selected**, it answers from general knowledge, says when it is unsure or when the answer depends on how your course defines something, and suggests choosing a study guide.
- **On a guide someone shared with you**, the Tutor answers only from that guide and says "This guide doesn't cover that." when the answer isn't there.

Refusing felt like the wrong way to help a student. If you're stuck at midnight and the tool just says "that's not in your guide," you leave and go ask something that won't tell you where its answer came from. Labeling it gets you the help and still tells you clearly which part goes beyond your course material, so you know what to double-check with your class. You get the help and you know exactly what to trust.

If you're deciding whether any AI study tool is safe to use with your class materials, the [guide to AI tutor safety](/guides/are-ai-tutors-safe-for-students) covers privacy, accuracy and academic integrity, with a checklist you can use on any tool.

## Is source-grounded tutoring right for every question?

It's best when the course's own version of the answer matters: definitions, the steps your professor taught, the cases or texts assigned in your class, and anything you will be graded on. It is less useful for questions your material doesn't cover at all; there, a grounded tool should send you back to the source or tell you it is going beyond it.

The habit worth keeping either way is the same one good students use with any explanation: find where it came from, read that part yourself, and then close everything and see whether you can explain it without help.
`;
