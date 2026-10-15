// One sample guide every student can try, written to work for any subject.
const pairs = [
  ['What is retrieval practice?', 'Retrieval practice is recalling information from memory instead of rereading it. Each successful recall strengthens the memory and makes it easier to reach next time.'],
  ['Why does spacing out study sessions help?', 'Spacing lets a little forgetting happen between sessions. Recalling something you have partly forgotten takes more effort, and that effort makes the memory last longer than cramming does.'],
  ['What is the forgetting curve?', 'The forgetting curve describes how quickly new information fades without review. Most loss happens in the first days, and each well-timed review flattens the curve.'],
  ['What is interleaving?', 'Interleaving mixes different topics or problem types in one session instead of practicing one type at a time. It helps you learn to choose the right approach, not just repeat one.'],
  ['How does explaining an idea in your own words help?', 'Explaining forces you to connect the idea to what you already know and exposes gaps. If you cannot explain it simply, you have found what to study next.'],
  ['Why do mistakes help learning?', 'A wrong answer followed by the right explanation is remembered better than a right guess. Mistakes show exactly where understanding breaks down.'],
];

export const SAMPLE_GUIDE = {
  title: 'How Memory Works',
  study_guide: pairs.map(([question, answer], index) => `Q${index + 1}: ${question}\nA${index + 1}: ${answer}`).join('\n'),
  notes: [
    '- Recall beats rereading.',
    '- Space reviews over days, not hours.',
    '- Mix topics in one session.',
    '- Explain ideas in your own words.',
    '- Treat mistakes as a map of what to study.',
  ].join('\n'),
  flashcards: [
    { front: 'Retrieval practice', back: 'Recalling information from memory instead of rereading it.' },
    { front: 'Spacing', back: 'Spreading study sessions out over time so some forgetting happens between them.' },
    { front: 'Forgetting curve', back: 'How quickly new information fades without review.' },
    { front: 'Interleaving', back: 'Mixing different topics or problem types in one session.' },
    { front: 'Self-explanation', back: 'Explaining an idea in your own words to find gaps.' },
    { front: 'Errorful learning', back: 'Learning from a wrong answer followed by the right explanation.' },
  ],
  source_type: 'sample',
  source_title: 'Cordia sample',
};

export const SAMPLE_HEADINGS = pairs.map(([question]) => question.replace(/\?$/, ''));
