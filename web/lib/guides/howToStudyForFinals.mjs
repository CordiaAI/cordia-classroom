// Draft: /guides/how-to-study-for-finals. Outside facts link to sources whose abstracts were read
// (listed in `sources`); Cordia facts match the code (lib/useCases/ has the file:line for each).
import { AUTHOR } from './author.mjs';

export default {
  slug: 'how-to-study-for-finals',
  title: 'How to study for finals: a plan that works in two weeks or two days',
  topic: 'How to Study for Finals',
  crumb: 'How to study for finals',
  description: 'A finals study plan that counts back from the exam date: test yourself, mix in old material, sleep, and keep the night before light. Two weeks or two days.',
  author: AUTHOR,
  datePublished: '2026-11-09',
  dateModified: '2026-11-09',
  draft: true,
  sources: [
    { title: 'Roediger & Karpicke (2006), "Test-Enhanced Learning", Psychological Science 17(3)', url: 'https://doi.org/10.1111/j.1467-9280.2006.01693.x', supports: 'Testing yourself beat restudying on tests 2 days and 1 week later, even though restudying felt better.' },
    { title: 'Cepeda et al. (2006), "Distributed practice in verbal recall tasks", Psychological Bulletin 132(3)', url: 'https://doi.org/10.1037/0033-2909.132.3.354', supports: 'Spreading study out helps, and the best gap between sessions grows with how long you need to remember.' },
    { title: 'Dunlosky et al. (2013), "Improving Students\' Learning With Effective Learning Techniques", Psychological Science in the Public Interest 14(1)', url: 'https://doi.org/10.1177/1529100612453266', supports: 'Practice testing and distributed practice rated high utility; rereading, highlighting and summarization low.' },
    { title: 'Rohrer, Dedrick & Stershic (2015), "Interleaved practice improves mathematics learning", Journal of Educational Psychology 107(3)', url: 'https://doi.org/10.1037/edu0000001', supports: 'Mixed (interleaved) practice beat blocked practice on tests 1 and 30 days later.' },
    { title: 'Yoo et al. (2007), "A deficit in the ability to form new human memories without sleep", Nature Neuroscience 10(3)', url: 'https://doi.org/10.1038/nn1851', supports: 'One night without sleep impaired memory formation the next day.' },
    { title: 'Thacher (2008), "University Students and the All Nighter", Behavioral Sleep Medicine 6(1)', url: 'https://doi.org/10.1080/15402000701796114', supports: 'All-nighters were common and associated with lower GPA (a correlation, not proof of cause).' },
    { title: 'CDC, "About Sleep"', url: 'https://www.cdc.gov/sleep/about/index.html', supports: 'Adults 18 to 60 need 7 or more hours of sleep.' },
    { title: 'Buehler, Griffin & Ross (1994), "Exploring the planning fallacy", Journal of Personality and Social Psychology 67(3)', url: 'https://doi.org/10.1037/0022-3514.67.3.366', supports: 'People predict too little time for their own academic tasks.' },
  ],
  related: ['/guides/ai-study-help-college', '/ai-quiz-generator', '/ai-flashcard-maker', '/ai-study-guide-generator'],
};

export const body = `
Plan backward from the exam date: list what the exam covers, give each topic a day, and spend most of every session answering questions from memory instead of rereading. Mix earlier material into each day, sleep normally the whole way through, and keep the night before for a short review and an early bed.

That plan works whether you have two weeks or two days. With two weeks you can space each topic out and come back to it several times; with two days you cut the list down to what is most likely to be tested and still use the same three habits: test yourself, mix topics, and sleep.

## Why plan backward from the exam date?

Because people reliably underestimate how long their own work will take. In one well-known set of studies, students' predictions of how long academic tasks would take were consistently too optimistic, and they based those predictions on the plan in their head rather than on how long similar work had taken them before ([Buehler, Griffin & Ross, 1994](https://doi.org/10.1037/0022-3514.67.3.366)).

Counting back from the exam turns a vague "I'll study this week" into a fixed number of days and a fixed list of topics. You see on day one whether the list fits, while there is still time to change it.

## How do I build a backward plan?

Start with the exam itself and work toward today.

- **Write the exam date and time at the bottom of the page.** Leave the last evening for review only.
- **List every topic the exam covers.** Use the syllabus, the review sheet, past quizzes and lecture headings, not your memory of the course.
- **Mark each topic by how well you know it right now.** Test yourself on two or three questions per topic to find out; how familiar the notes look is a poor guide.
- **Give the weakest topics the earliest days**, so they come back again before the exam.
- **Add one buffer day** for the topic that turns out harder than you thought.

<!-- PERSONAL EXAMPLE (Jude): a time a plan fell apart because a topic took twice as long as expected, and what the buffer day saved. -->

If you use Cordia, adding the exam as your test date in Learn does the counting for you: it shows how many ideas to master each day to be ready the day before.

## What if I fall behind the plan?

Move topics, don't drop the habits. When a day goes badly, push its topic into the buffer day and keep the next day as planned, rather than trying to do two days at once late at night. If you fall behind by more than the buffer, cut the topics that are worth the fewest points or that you already know best, and say so on the plan so you stop worrying about them.

The plan is there to tell you early what doesn't fit. A plan you adjust on day four is far more useful than one you discover was impossible on the last night, which is exactly the situation the backward count is designed to prevent.

## What should a study session look like?

Most of it should be retrieval: closing the notes and answering questions from memory, then checking. In a classic experiment, students who took recall tests on a passage remembered substantially more two days and one week later than students who spent the same time restudying it, even though restudying made them feel more confident ([Roediger & Karpicke, 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x)).

A large review of ten common study techniques reached the same conclusion from many studies: practice testing and spreading study out were rated high utility, while rereading, highlighting and summarizing were rated low ([Dunlosky et al., 2013](https://doi.org/10.1177/1529100612453266)). Rereading feels productive because the material looks familiar, but recognizing a page is not the same as being able to produce the answer on a blank exam.

A simple session that follows this:

- Ten minutes skimming one topic's notes, just to load it.
- Thirty to forty minutes answering questions on it without looking: practice problems, flashcards, or questions you write yourself from the headings.
- Checking every answer, and writing down the ones you got wrong or guessed.
- Starting the next session with those misses.

In Cordia, the quizzes live in Learn under **Test yourself**: Quiz asks your guide's questions and brings each miss back a few questions later until you get it right, and Timed test gives you a mock exam on the clock.

## Should I review earlier material or just the newest topics?

Review earlier material every day, mixed in with the new. Spacing works because coming back to a topic after a gap makes you work to recall it, and a large review of spacing studies found that the best gap between study sessions grows with how long you need to remember the material ([Cepeda et al., 2006](https://doi.org/10.1037/0033-2909.132.3.354)). For a final two weeks away, that means returning to each topic a few days apart rather than finishing it once and moving on.

Mixing different kinds of problems in one session helps too. In a classroom experiment, math students whose practice mixed problem types scored higher than students who practiced one type at a time, both on a test the next day and on a test 30 days later ([Rohrer, Dedrick & Stershic, 2015](https://doi.org/10.1037/edu0000001)). On an exam, the questions come mixed and you have to recognize which method each one needs; mixed practice rehearses exactly that.

<!-- PERSONAL EXAMPLE (Jude): a course where mixing old and new problems exposed a method you thought you knew. -->

## How much sleep do I need during finals?

The same amount as the rest of the term: the CDC recommends 7 or more hours a night for adults aged 18 to 60 ([CDC](https://www.cdc.gov/sleep/about/index.html)). Sleep is not time taken away from studying; it is part of how studying sticks.

Sleep before learning matters as well as sleep after. In one brain-imaging study, a single night without sleep impaired people's ability to form new memories the next day, and they remembered less of what they studied ([Yoo et al., 2007](https://doi.org/10.1038/nn1851)). An all-nighter before an exam asks your memory to work at the moment you have weakened it.

All-nighters are also common. In a survey of 120 students at one college, 60 percent had pulled at least one, and those students tended to have lower GPAs ([Thacher, 2008](https://doi.org/10.1080/15402000701796114)). That study shows an association, not proof that the all-nighters caused the lower grades, but it gives no support for the idea that they help.

## What should I do the night before the exam?

Keep it light and finish early. The heavy lifting should already be done.

- **Do one short round of recall** on your list of past misses, not a full reread of the course.
- **Look over the formats**: which sections, how many points, how long you have.
- **Get logistics settled**: room, time, ID, calculator, pencils, charger, alarm.
- **Stop studying an hour or so before bed** and go to sleep at your usual time.

If something comes up that you can't answer, write it on a card and look at it once in the morning. Learning new material late at night costs you sleep, which costs you the material you already know.

## What does the plan look like at 14, 7 and 3 days out?

The table shows the same three habits at three different starting points. Fit the topics to the days you have; the shape stays the same.

| Days before the exam | Main goal | Each day | What to skip |
| --- | --- | --- | --- |
| 14 days | Cover every topic at least twice | Two or three topics: test yourself first, then fix gaps; mix in one earlier topic | Rewriting notes neatly |
| 7 days | Close the weakest gaps | One weak topic in depth, then mixed questions across everything covered so far | New sources you haven't used all term |
| 3 days | Practice under exam conditions | A timed set of mixed questions, then review every miss | Rereading whole chapters |
| Night before | Rest and logistics | One short round on past misses, then an early night | Anything new |

## What if I only have two days?

Cut the list, not the method. With two days you cannot cover everything at depth, so put your time where the exam is most likely to look.

- **Spend the first hour triaging.** Rank topics by how much of the exam they cover and how weak you are on them. Start at the top.
- **Test before you read.** Answer a few questions per topic first; read only what you got wrong.
- **Mix topics on day two.** Do a timed mixed set in the morning and spend the afternoon on the misses.
- **Still sleep both nights.** Two nights of normal sleep protect what you learn on both days.

<!-- PERSONAL EXAMPLE (Jude): a two-day finals crunch, what got cut, and how the exam went. -->

If your notes are scattered across slides and PDFs, turning them into one set of questions first saves time you would otherwise spend deciding what to study. That is what Cordia's study guides are built for, and the [guide to studying with AI in college](/guides/ai-study-help-college) walks through the whole process.

## Does this work for every subject?

The habits do; the questions change. In a math or science course, "testing yourself" means working problems without the solution open. In a history or literature course it means explaining a cause, an argument or a passage in your own words without notes. In a nursing or law course it means applying a rule to a case you haven't seen before.

Whatever the subject, the test is the same: can you produce the answer from a blank page? If you can, you know it. If you can only recognize it when you see it, keep practicing.
`;
