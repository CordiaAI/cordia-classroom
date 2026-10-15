import { useMemo, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import GroveTree from './GroveTree';
import { groveKey, useProgress } from '../lib/progress';
import { dayKey, readActivity, semesterName } from '../lib/activity';

const HEX = { 'var(--olive-press)': '#3D4937', 'var(--olive)': '#536149' };

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));
}

// "Semester in Cordia": hours, cards, top class and the grove, shareable as a PNG.
export default function RecapCard({ guides, folders, since, cardsStudied = 0 }) {
  const progress = useProgress();
  const treesRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  const stats = useMemo(() => {
    const log = readActivity();
    const from = dayKey(since);
    let minutes = 0;
    let cards = 0;
    const byGuide = {};
    for (const [key, day] of Object.entries(log)) {
      if (key < from) continue;
      minutes += day.m || 0;
      cards += day.c || 0;
      for (const [guide, entry] of Object.entries(day.g || {})) byGuide[guide] = (byGuide[guide] || 0) + (entry.m || 0);
    }
    const byFolder = {};
    for (const guide of guides) {
      if (!guide.folder_id) continue;
      byFolder[guide.folder_id] = (byFolder[guide.folder_id] || 0) + (byGuide[groveKey(guide.id)] || progress.grove[groveKey(guide.id)] || 0);
    }
    const topId = Object.entries(byFolder).sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      hours: Math.round((minutes / 60) * 10) / 10,
      cards: cards || cardsStudied,
      topClass: folders.find(folder => folder.id === topId)?.name || '–',
    };
  }, [guides, folders, since, progress.grove, cardsStudied]);
  const trees = guides.filter(guide => new Date(guide.created_at) >= since).slice(0, 8);
  const name = semesterName();

  async function share() {
    setSharing(true);
    try {
      const width = 1080;
      const height = 1080;
      const treeMarkup = [...(treesRef.current?.querySelectorAll('svg') || [])].map((svg, index) => {
        let inner = svg.innerHTML;
        for (const [variable, hex] of Object.entries(HEX)) inner = inner.split(variable).join(hex);
        const x = 90 + (index % 4) * 230;
        const y = 560 + Math.floor(index / 4) * 210;
        return `<svg x="${x}" y="${y}" width="200" height="200" viewBox="0 0 100 100">${inner.replace(/<style[\s\S]*?<\/style>/g, '')}</svg>`;
      }).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#EDF2F4"/>
        <rect x="48" y="48" width="${width - 96}" height="${height - 96}" rx="40" fill="#FFFFFC"/>
        <text x="96" y="160" font-family="Georgia, serif" font-size="64" font-weight="600" fill="#171B18">${escapeXml(name)} in Cordia</text>
        <text x="96" y="300" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="700" fill="#536149">${stats.hours}</text>
        <text x="96" y="350" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#171B18">hours</text>
        <text x="420" y="300" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="700" fill="#536149">${stats.cards}</text>
        <text x="420" y="350" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#171B18">cards</text>
        <text x="96" y="450" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#636B65">Top class</text>
        <text x="96" y="500" font-family="Georgia, serif" font-size="44" font-weight="600" fill="#171B18">${escapeXml(stats.topClass)}</text>
        ${treeMarkup}
      </svg>`;
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], `${name.replace(/\s+/g, '-')}-in-Cordia.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${name} in Cordia` });
      else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
    } catch {
      // Share was cancelled.
    }
    setSharing(false);
  }

  return (
    <section className="c-glass recap" aria-labelledby="recap-title">
      <header className="c-row">
        <h2 id="recap-title" className="c-section-title">{name}</h2>
        <span className="c-spacer" />
        <button type="button" className="c-btn c-btn--secondary" onClick={share} disabled={sharing}><Share2 size={20} strokeWidth={1.75} aria-hidden="true" />Share</button>
      </header>
      <ul className="recap-stats">
        <li><strong>{stats.hours}</strong><span>hours</span></li>
        <li><strong>{stats.cards}</strong><span>cards</span></li>
        <li><strong className="recap-class">{stats.topClass}</strong><span>top class</span></li>
      </ul>
      <div className="recap-trees" ref={treesRef} aria-hidden="true">
        {trees.map(guide => {
          const key = groveKey(guide.id);
          return <GroveTree key={guide.id} minutes={progress.grove[key] || 0} rings={progress.rings[key] || 0} size={64} />;
        })}
      </div>
      <style jsx>{`
        .recap { display: grid; gap: 16px; padding: 20px; border-radius: var(--r-card); }
        .recap-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .recap-stats li { display: grid; gap: 4px; min-width: 0; }
        .recap-stats strong { font: 600 32px/1 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--olive-ink); }
        .recap-stats .recap-class { font: 600 19px/1.2 var(--font-display); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .recap-trees { display: flex; flex-wrap: wrap; gap: 4px; min-height: 64px; }
      `}</style>
    </section>
  );
}
