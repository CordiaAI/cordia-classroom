function organizeDashboardGuides(folders, guides) {
  const safeFolders = Array.isArray(folders) ? folders : [];
  const safeGuides = Array.isArray(guides) ? guides : [];
  const folderIds = new Set(safeFolders.map(folder => folder.id));

  return {
    classes: safeFolders.map(folder => ({
      folder,
      guides: safeGuides.filter(guide => guide.folder_id === folder.id),
    })),
    unclassified: safeGuides.filter(guide => !guide.folder_id || !folderIds.has(guide.folder_id)),
  };
}

function createDashboardOverview(folders, guides) {
  const safeFolders = Array.isArray(folders) ? folders : [];
  const safeGuides = Array.isArray(guides) ? guides : [];
  const folderNames = new Map(safeFolders.map(folder => [folder.id, folder.name]));
  const sorted = [...safeGuides].sort((left, right) => {
    const leftDate = new Date(left?.created_at || 0).getTime() || 0;
    const rightDate = new Date(right?.created_at || 0).getTime() || 0;
    return rightDate - leftDate;
  });
  const inProgress = sorted.find(guide => Number(guide?.read_progress) > 0 && Number(guide?.read_progress) < 1);

  return {
    continueGuide: inProgress || sorted[0] || null,
    reviewGuide: sorted.find(guide => (Array.isArray(guide?.flashcards) && guide.flashcards.length > 0) || Number(guide?.flashcard_count) > 0) || null,
    recentGuides: sorted.slice(0, 4).map(guide => ({
      ...guide,
      className: folderNames.get(guide.folder_id) || 'No class',
    })),
  };
}

module.exports = { organizeDashboardGuides, createDashboardOverview };
