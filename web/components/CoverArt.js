import { Music, Piano, Guitar, Mic, Headphones, Palette, Brush, PenTool, Camera, Film, Drama, BookOpen, Library, Scroll, Feather, Quote, PenLine, Newspaper, Languages, Globe, Earth, Map, Compass, Landmark, Church, Cross, Crown, Swords, Shield, Hourglass, Flag, Vote, Scale, Gavel, Briefcase, Handshake, ChartLine, ChartPie, DollarSign, PiggyBank, Building2, Store, Megaphone, Users, Brain, Smile, HeartPulse, Heart, Stethoscope, Pill, Syringe, Activity, Bone, Eye, Baby, Dna, Microscope, FlaskConical, Atom, Flame, Droplet, Zap, Leaf, Sprout, TreePine, Bird, Fish, Sun, Moon, Star, Telescope, Rocket, CloudSun, Mountain, Waves, Calculator, Sigma, Pi, Ruler, Puzzle, Cpu, Code, Database, Laptop, Wrench, Hammer, Cog, Trophy, Dumbbell, Apple, Utensils, Shirt, House, Bus, Plane, GraduationCap, Lightbulb, Award } from 'lucide-react';

export const COVER_ICON_COMPONENTS = { Music, Piano, Guitar, Mic, Headphones, Palette, Brush, PenTool, Camera, Film, Drama, BookOpen, Library, Scroll, Feather, Quote, PenLine, Newspaper, Languages, Globe, Earth, Map, Compass, Landmark, Church, Cross, Crown, Swords, Shield, Hourglass, Flag, Vote, Scale, Gavel, Briefcase, Handshake, ChartLine, ChartPie, DollarSign, PiggyBank, Building2, Store, Megaphone, Users, Brain, Smile, HeartPulse, Heart, Stethoscope, Pill, Syringe, Activity, Bone, Eye, Baby, Dna, Microscope, FlaskConical, Atom, Flame, Droplet, Zap, Leaf, Sprout, TreePine, Bird, Fish, Sun, Moon, Star, Telescope, Rocket, CloudSun, Mountain, Waves, Calculator, Sigma, Pi, Ruler, Puzzle, Cpu, Code, Database, Laptop, Wrench, Hammer, Cog, Trophy, Dumbbell, Apple, Utensils, Shirt, House, Bus, Plane, GraduationCap, Lightbulb, Award };

// A class cover: its colour, a soft dotted wash, and up to three subject icons (one large, two
// small). Drawn from tokens, so it fits light and dark themes and never needs an image.
export default function CoverArt({ color = 0, icons = [], className = '' }) {
  const [First, Second, Third] = icons.map(name => COVER_ICON_COMPONENTS[name]).filter(Boolean);
  const tone = (Number(color) % 8) + 1;
  return (
    <span className={'ca ' + className} style={{ '--ca-bg': `var(--cover-${tone})`, '--ca-ink': `var(--cover-ink-${tone})` }} aria-hidden="true">
      {First && <span className="ca-i ca-i1"><First strokeWidth={1.5} /></span>}
      {Second && <span className="ca-i ca-i2"><Second strokeWidth={1.6} /></span>}
      {Third && <span className="ca-i ca-i3"><Third strokeWidth={1.6} /></span>}
      <style jsx global>{`
        .ca { position: absolute; inset: 0; container-type: size; overflow: hidden; background: var(--ca-bg); color: var(--ca-ink); }
        .ca::before { content: ''; position: absolute; inset: 0; background:
          radial-gradient(circle at 50% 52%, color-mix(in srgb, var(--ca-ink) 13%, transparent) 0 31cqh, transparent calc(31cqh + 1px)),
          radial-gradient(color-mix(in srgb, var(--ca-ink) 16%, transparent) 1.2px, transparent 1.6px) 0 0 / 14px 14px; }
        .ca::after { content: ''; position: absolute; inset: 0; background: linear-gradient(160deg, transparent 40%, color-mix(in srgb, var(--ca-ink) 10%, transparent)); }
        .ca-i { position: absolute; z-index: 1; display: grid; place-items: center; transform: translate(-50%, -50%); transition: transform var(--dur) var(--ease); }
        .ca-i svg { width: 100%; height: 100%; }
        .ca-i1 { left: 50%; top: 52%; width: 38cqh; height: 38cqh; }
        .ca-i2 { left: 21%; top: 30%; width: 19cqh; height: 19cqh; opacity: .8; }
        .ca-i3 { left: 79%; top: 72%; width: 17cqh; height: 17cqh; opacity: .8; }
        a:hover .ca-i1 { transform: translate(-50%, -50%) scale(1.06); }
        a:hover .ca-i2 { transform: translate(-50%, -50%) rotate(-6deg) scale(1.06); }
        a:hover .ca-i3 { transform: translate(-50%, -50%) rotate(6deg) scale(1.06); }
        @media (prefers-reduced-motion: reduce) { .ca-i { transition: none; } }
      `}</style>
    </span>
  );
}
