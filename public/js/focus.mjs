// Browser-side focus feed and asset counts. Category defaults live in the ledger
// after migration; this module only reads real collections.

export const GREETING = "Hello BEN, let's change the world!";

function companionFrom(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    enabled: source.enabled !== false,
    voice: source.voice !== false,
    autostart: source.autostart === true,
    speakMode: source.speakMode === "always" ? "always" : "daily",
    mutedDate: typeof source.mutedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.mutedDate) ? source.mutedDate : "",
  };
}

export function shouldSpeak({ settings, today, lastSpokenDate }) {
  const companion = companionFrom(settings);
  if (!companion.enabled || !companion.voice) return false;
  if (companion.mutedDate && companion.mutedDate === today) return false;
  if (companion.speakMode === "always") return true;
  return lastSpokenDate !== today;
}

function live(list) {
  return (Array.isArray(list) ? list : []).filter((item) => item && item.archived !== true);
}

export function assetSnapshot(store = {}) {
  const library = live(store.skillLibrary);
  const memories = live(store.memories);
  const lessons = live(store.lessons);
  const prompts = live(store.prompts);
  const artifacts = live(store.artifacts);
  const skills = live(store.skills);
  const runs = live(store.skillRuns);
  const drafts = library.filter((skill) => skill.state === "draft");
  const published = library.filter((skill) => skill.state === "published");
  return {
    stats: [
      { id: "skills", value: library.length },
      { id: "atoms", value: memories.length },
      { id: "lessons", value: lessons.length },
      { id: "prompts", value: prompts.length },
    ],
    counts: {
      skills: library.length,
      atoms: memories.length,
      materials: artifacts.length,
      lessons: lessons.length,
      prompts: prompts.length,
      pending: drafts.length,
    },
    drafts: drafts.length,
    published: published.length,
    legacySkills: skills.length,
    skillRuns: runs.length,
    library,
    memories,
    lessons,
    prompts,
    artifacts,
    skills,
    runs,
  };
}

export function feedFor(category, store = {}) {
  if (!category || category.legacy) return { runs: [], memories: [] };
  const sourceIds = new Set([...(category.sourceIds || []), category.intakeSourceId].filter((item) => typeof item === "string" && item));
  const tags = new Set((category.memoryTags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean));
  const runs = live(store.briefRuns)
    .filter((run) => sourceIds.has(run.sourceId))
    .sort((a, b) => String(b.completedAt || b.receivedAt || "").localeCompare(String(a.completedAt || a.receivedAt || "")));
  const memories = live(store.memories).filter((memory) => (memory.tags || []).some((tag) => tags.has(String(tag).trim().toLowerCase())));
  return { runs, memories };
}
