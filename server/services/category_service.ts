import {normalizeLanguageList, normalizeRegionList} from '../../shared/locale';
import type {Category, Tag, TagRelation} from '../../shared/types';
import {HIDDEN_GEMS_TAG_NAME, previewTagSuggestions} from '../core/domain_expansion';
import {getDb} from '../db/database';
import {getPreferences, updatePreferences} from './preference_service';

interface CategoryRow {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
  is_enabled: number;
  languages: string | null;
  regions: string | null;
  created_at: string;
  updated_at: string;
}

interface TagRow {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  priority: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: number;
  tag_id: number;
  term: string;
  relation_type: 'expanded' | 'exclusion';
  is_enabled: number;
  is_user_defined: number;
  created_at: string;
}

function parseLocaleArray(
  raw: string | null,
  kind: 'lang' | 'region',
  allowedCustomCodes: string[] = []
): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return kind === 'lang'
      ? normalizeLanguageList(parsed, [], allowedCustomCodes)
      : normalizeRegionList(parsed, [], allowedCustomCodes);
  } catch {
    return null;
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'category';
}

function uniqueSlug(baseName: string, excludeId?: number): string {
  const db = getDb();
  const base = slugify(baseName);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = excludeId
      ? (db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').get(candidate, excludeId) as {id: number} | undefined)
      : (db.prepare('SELECT id FROM categories WHERE slug = ?').get(candidate) as {id: number} | undefined);
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix++;
  }
}

export function listCategories(): Category[] {
  const db = getDb();
  const catRows = db
    .prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC')
    .all() as unknown as CategoryRow[];
  const tagRows = db
    .prepare('SELECT * FROM tags ORDER BY priority DESC, id ASC')
    .all() as unknown as TagRow[];
  const relRows = db
    .prepare('SELECT * FROM tag_relations ORDER BY id ASC')
    .all() as unknown as RelationRow[];

  const relsByTag = new Map<number, TagRelation[]>();
  for (const r of relRows) {
    const list = relsByTag.get(r.tag_id) || [];
    list.push({
      id: r.id,
      tagId: r.tag_id,
      term: r.term,
      relationType: r.relation_type,
      isEnabled: r.is_enabled === 1,
      isUserDefined: r.is_user_defined === 1,
      createdAt: r.created_at,
    });
    relsByTag.set(r.tag_id, list);
  }

  const tagsByCat = new Map<number, Tag[]>();
  for (const t of tagRows) {
    const list = tagsByCat.get(t.category_id) || [];
    list.push({
      id: t.id,
      categoryId: t.category_id,
      name: t.name,
      description: t.description,
      priority: t.priority,
      isEnabled: t.is_enabled === 1,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      relations: relsByTag.get(t.id) || [],
    });
    tagsByCat.set(t.category_id, list);
  }

  const prefs = getPreferences();
  const customLangCodes = prefs.customLanguages.map((l) => l.code);
  const customRegCodes = prefs.customRegions.map((r) => r.code);

  return catRows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    sortOrder: c.sort_order,
    isEnabled: c.is_enabled === 1,
    languages: parseLocaleArray(c.languages, 'lang', customLangCodes),
    regions: parseLocaleArray(c.regions, 'region', customRegCodes),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    tags: tagsByCat.get(c.id) || [],
  }));
}

export function createCategory(input: {
  name: string;
  icon?: string;
  languages?: string[] | null;
  regions?: string[] | null;
}): Category {
  const db = getDb();
  const name = input.name.trim();
  if (!name) {
    throw new Error('Category name is required');
  }
  const icon = (input.icon || 'bookmark').trim();
  const slug = uniqueSlug(name);
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories').get() as {m: number};
  const prefs = getPreferences();
  const customLangCodes = prefs.customLanguages.map((l) => l.code);
  const customRegCodes = prefs.customRegions.map((r) => r.code);

  const langsJson =
    input.languages && input.languages.length > 0
      ? JSON.stringify(normalizeLanguageList(input.languages, [], customLangCodes))
      : null;
  const regsJson =
    input.regions && input.regions.length > 0
      ? JSON.stringify(normalizeRegionList(input.regions, [], customRegCodes))
      : null;

  const result = db
    .prepare(
      'INSERT INTO categories (name, slug, icon, sort_order, languages, regions) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(name, slug, icon, maxOrder.m + 1, langsJson, regsJson);

  updatePreferences({onboardingCompleted: true});

  const created = listCategories().find((c) => c.id === Number(result.lastInsertRowid));
  if (!created) throw new Error('Failed to load created category');
  return created;
}

export function updateCategory(
  id: number,
  input: {
    name?: string;
    icon?: string;
    isEnabled?: boolean;
    languages?: string[] | null;
    regions?: string[] | null;
  }
): Category {
  const db = getDb();
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  if (!current) throw new Error('Category not found');

  const prefs = getPreferences();
  const customLangCodes = prefs.customLanguages.map((l) => l.code);
  const customRegCodes = prefs.customRegions.map((r) => r.code);

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (!nextName) throw new Error('Category name cannot be empty');
  const nextSlug = input.name !== undefined ? uniqueSlug(nextName, id) : current.slug;
  const nextIcon = input.icon !== undefined ? input.icon.trim() || current.icon : current.icon;
  const nextEnabled = input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : current.is_enabled;

  let nextLangsJson = current.languages;
  if (input.languages !== undefined) {
    if (input.languages && input.languages.length > 0) {
      const normalized = normalizeLanguageList(input.languages, [], customLangCodes);
      nextLangsJson = normalized.length > 0 ? JSON.stringify(normalized) : null;
    } else {
      nextLangsJson = null;
    }
  }

  let nextRegsJson = current.regions;
  if (input.regions !== undefined) {
    if (input.regions && input.regions.length > 0) {
      const normalized = normalizeRegionList(input.regions, [], customRegCodes);
      nextRegsJson = normalized.length > 0 ? JSON.stringify(normalized) : null;
    } else {
      nextRegsJson = null;
    }
  }

  db.prepare(
    `UPDATE categories SET name = ?, slug = ?, icon = ?, is_enabled = ?, languages = ?, regions = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(nextName, nextSlug, nextIcon, nextEnabled, nextLangsJson, nextRegsJson, id);

  const updated = listCategories().find((c) => c.id === id);
  if (!updated) throw new Error('Category not found after update');
  return updated;
}

export function deleteCategory(id: number): void {
  const db = getDb();
  const res = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (res.changes === 0) throw new Error('Category not found');
}

export function reorderCategories(orderedIds: number[]): Category[] {
  const db = getDb();
  const stmt = db.prepare(`UPDATE categories SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`);
  orderedIds.forEach((id, idx) => {
    stmt.run(idx, id);
  });
  return listCategories();
}

export function createTag(input: {
  categoryId: number;
  name: string;
  description?: string | null;
  priority?: number;
  expandedTerms?: string[];
  exclusions?: string[];
  autoExpand?: boolean;
}): Tag {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Tag name is required');

  const category = db
    .prepare('SELECT id, name, languages FROM categories WHERE id = ?')
    .get(input.categoryId) as {id: number; name: string; languages: string | null} | undefined;
  if (!category) throw new Error('Category not found');

  const priority = Math.max(1, Math.min(5, Math.round(Number(input.priority) || 3)));
  const description = input.description?.trim() || null;

  const result = db
    .prepare('INSERT INTO tags (category_id, name, description, priority) VALUES (?, ?, ?, ?)')
    .run(input.categoryId, name, description, priority);

  const tagId = Number(result.lastInsertRowid);
  const insertRel = db.prepare(
    'INSERT OR IGNORE INTO tag_relations (tag_id, term, relation_type, is_enabled, is_user_defined) VALUES (?, ?, ?, 1, ?)'
  );

  const prefs = getPreferences();
  const catLangs =
    parseLocaleArray(
      category.languages,
      'lang',
      prefs.customLanguages.map((l) => l.code)
    ) || prefs.languages;
  const preview = previewTagSuggestions(name, {
    categoryName: category.name,
    languages: catLangs,
  });

  if (Array.isArray(input.expandedTerms)) {
    for (const term of input.expandedTerms) {
      const clean = term.trim();
      if (clean) {
        insertRel.run(tagId, clean, 'expanded', 1);
      }
    }
  } else if (input.autoExpand !== false) {
    for (const s of preview.suggestions) {
      insertRel.run(tagId, s.term, 'expanded', 0);
    }
  }

  const effectiveExclusions =
    input.exclusions && input.exclusions.length > 0 ? input.exclusions : preview.exclusions;
  for (const ex of effectiveExclusions) {
    const clean = ex.trim();
    if (clean) {
      insertRel.run(tagId, clean, 'exclusion', input.exclusions ? 1 : 0);
    }
  }

  const cat = listCategories().find((c) => c.id === input.categoryId);
  const createdTag = cat?.tags.find((t) => t.id === tagId);
  if (!createdTag) throw new Error('Failed to retrieve created tag');
  return createdTag;
}

export function updateTag(
  id: number,
  input: {name?: string; description?: string | null; priority?: number; isEnabled?: boolean}
): Tag {
  const db = getDb();
  const current = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
  if (!current) throw new Error('Tag not found');

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (!nextName) throw new Error('Tag name cannot be empty');
  const nextDesc = input.description !== undefined ? input.description?.trim() || null : current.description;
  const nextPriority =
    input.priority !== undefined ? Math.max(1, Math.min(5, Math.round(Number(input.priority)))) : current.priority;
  const nextEnabled = input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : current.is_enabled;

  db.prepare(
    `UPDATE tags SET name = ?, description = ?, priority = ?, is_enabled = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(nextName, nextDesc, nextPriority, nextEnabled, id);

  const cat = listCategories().find((c) => c.id === current.category_id);
  const updated = cat?.tags.find((t) => t.id === id);
  if (!updated) throw new Error('Tag not found after update');
  return updated;
}

export function deleteTag(id: number): void {
  const db = getDb();
  const res = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  if (res.changes === 0) throw new Error('Tag not found');
}

export function addTagRelation(input: {
  tagId: number;
  term: string;
  relationType: 'expanded' | 'exclusion';
}): TagRelation {
  const db = getDb();
  const term = input.term.trim();
  if (!term) throw new Error('Term is required');

  const res = db
    .prepare(
      'INSERT INTO tag_relations (tag_id, term, relation_type, is_enabled, is_user_defined) VALUES (?, ?, ?, 1, 1)'
    )
    .run(input.tagId, term, input.relationType);

  const row = db.prepare('SELECT * FROM tag_relations WHERE id = ?').get(Number(res.lastInsertRowid)) as unknown as RelationRow;
  return {
    id: row.id,
    tagId: row.tag_id,
    term: row.term,
    relationType: row.relation_type,
    isEnabled: row.is_enabled === 1,
    isUserDefined: row.is_user_defined === 1,
    createdAt: row.created_at,
  };
}

export function toggleTagRelation(id: number, isEnabled: boolean): void {
  const db = getDb();
  const res = db.prepare('UPDATE tag_relations SET is_enabled = ? WHERE id = ?').run(isEnabled ? 1 : 0, id);
  if (res.changes === 0) throw new Error('Tag relation not found');
}

export function deleteTagRelation(id: number): void {
  const db = getDb();
  const res = db.prepare('DELETE FROM tag_relations WHERE id = ?').run(id);
  if (res.changes === 0) throw new Error('Tag relation not found');
}

export function ensureCinemaPreset(): Category {
  const existing = listCategories();
  const found = existing.find(
    (c) => c.slug === 'cinema' || c.name.toLowerCase() === 'cinema' || c.name.toLowerCase() === 'entertainment'
  );
  if (found) {
    const hasHiddenGems = found.tags.some(
      (t) => t.name.toLowerCase() === HIDDEN_GEMS_TAG_NAME.toLowerCase()
    );
    if (!hasHiddenGems) {
      createTag({
        categoryId: found.id,
        name: HIDDEN_GEMS_TAG_NAME,
        priority: 5,
        autoExpand: true,
      });
    }
    return listCategories().find((c) => c.id === found.id) || found;
  }

  const cat = createCategory({name: 'Cinema', icon: 'film'});
  const defaultTags = [
    {name: HIDDEN_GEMS_TAG_NAME, priority: 5},
    {name: 'Psychological Thriller', priority: 4},
    {name: 'Stanley Kubrick', priority: 4},
    {name: 'World Cinema', priority: 3},
  ];
  for (const t of defaultTags) {
    createTag({
      categoryId: cat.id,
      name: t.name,
      priority: t.priority,
      autoExpand: true,
    });
  }
  return listCategories().find((c) => c.id === cat.id) || cat;
}

export function seedStarterWorkspace(): Category[] {
  const existing = listCategories();
  if (existing.length > 0) return existing;

  const starter: Array<{name: string; icon: string; tags: Array<{name: string; priority: number}>}> = [
    {
      name: 'Chemistry',
      icon: 'flask',
      tags: [
        {name: 'Catalysis', priority: 4},
        {name: 'Green chemistry', priority: 4},
        {name: 'Hydroformylation', priority: 5},
        {name: 'Deep eutectic solvents', priority: 3},
      ],
    },
    {
      name: 'Technology',
      icon: 'cpu',
      tags: [
        {name: 'Artificial intelligence', priority: 4},
        {name: 'Open-source software', priority: 3},
        {name: 'Cybersecurity', priority: 3},
      ],
    },
    {
      name: 'Astronomy',
      icon: 'orbit',
      tags: [
        {name: 'Exoplanets', priority: 5},
        {name: 'Astrophysics', priority: 4},
        {name: 'Space exploration', priority: 3},
      ],
    },
    {
      name: 'Cinema',
      icon: 'film',
      tags: [
        {name: HIDDEN_GEMS_TAG_NAME, priority: 5},
        {name: 'Psychological Thriller', priority: 4},
        {name: 'Stanley Kubrick', priority: 4},
        {name: 'World Cinema', priority: 3},
      ],
    },
  ];

  for (const catInput of starter) {
    const cat = createCategory({name: catInput.name, icon: catInput.icon});
    for (const t of catInput.tags) {
      createTag({
        categoryId: cat.id,
        name: t.name,
        priority: t.priority,
        autoExpand: true,
      });
    }
  }

  return listCategories();
}
