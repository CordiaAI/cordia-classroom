import {
  BookText, Brain, CalendarCheck, CalendarDays, ChartColumn, FileText, FolderSync, MailCheck, Layers, Link2, MessageCircle, MessageSquareText, Mic, NotebookPen, PencilRuler,
  Plug, Puzzle, Shapes, Shuffle, Sparkles, SquarePlus, Timer, Upload,
} from 'lucide-react';

// Every feature, grouped the way Learn Cordia shows them. Ids match MINI walkthroughs.
export const FEATURE_GROUPS = [
  { label: 'Make study material', items: [
    { id: 'add', label: 'Add material', icon: Upload },
    { id: 'record', label: 'Record a lecture', icon: Mic },
    { id: 'notes', label: 'Notes', icon: NotebookPen },
    { id: 'visual', label: 'Visuals', icon: Shapes },
    { id: 'card', label: 'Make card', icon: SquarePlus },
    { id: 'extension', label: 'Extension', icon: Puzzle },
  ] },
  { label: 'Study', items: [
    { id: 'explain', label: 'Explain', icon: Sparkles },
    { id: 'ask', label: 'Tutor', icon: MessageCircle },
    { id: 'quiz', label: 'Quiz', icon: Brain },
    { id: 'match', label: 'Match', icon: Shuffle },
    { id: 'cards', label: 'Cards', icon: Layers },
    { id: 'practice', label: 'Practice', icon: PencilRuler },
  ] },
  { label: 'Stay on track', items: [
    { id: 'insights', label: 'Insights', icon: ChartColumn },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'canvas', label: 'Canvas', icon: Link2 },
    { id: 'connectors', label: 'Connectors', icon: Plug },
    { id: 'assistant', label: 'Assistant', icon: MessageSquareText },
  ] },
  // What connected apps add; each "Show me" opens the app's sheet, where "Try it" walks through it.
  { label: 'Your apps', items: [
    { id: 'plan-week', label: 'Plan your week', icon: CalendarCheck },
    { id: 'docs', label: 'Google Docs', icon: FileText },
    { id: 'notion', label: 'Notion', icon: BookText },
    { id: 'drive', label: 'Drive folders', icon: FolderSync },
    { id: 'email-watch', label: 'Email date changes', icon: MailCheck },
  ] },
];

export const FEATURE_LIST = FEATURE_GROUPS.flatMap(group => group.items);
