import {Router} from 'express';
import {previewTagSuggestions} from '../core/domain_expansion';
import {
  addTagRelation,
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  deleteTagRelation,
  ensureCinemaPreset,
  listCategories,
  reorderCategories,
  seedStarterWorkspace,
  toggleTagRelation,
  updateCategory,
  updateTag,
} from '../services/category_service';
import {getPreferences} from '../services/preference_service';

export const categoriesRouter = Router();

categoriesRouter.get('/categories', (_req, res) => {
  res.json({categories: listCategories()});
});

categoriesRouter.post('/categories', (req, res) => {
  try {
    const category = createCategory({
      name: String(req.body?.name || ''),
      icon: typeof req.body?.icon === 'string' ? req.body.icon : 'bookmark',
      languages: Array.isArray(req.body?.languages) ? req.body.languages : null,
      regions: Array.isArray(req.body?.regions) ? req.body.regions : null,
    });
    res.status(201).json({category});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to create category'});
  }
});

categoriesRouter.post('/categories/starter', (_req, res) => {
  try {
    const categories = seedStarterWorkspace();
    res.status(201).json({categories});
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Failed to create starter workspace'});
  }
});

categoriesRouter.post('/categories/cinema-preset', (_req, res) => {
  try {
    const category = ensureCinemaPreset();
    res.status(201).json({category, categories: listCategories()});
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Failed to add Cinema preset'});
  }
});

categoriesRouter.put('/categories/reorder', (req, res) => {
  try {
    const orderedIds = Array.isArray(req.body?.orderedIds)
      ? req.body.orderedIds.map(Number).filter((n: number) => Number.isFinite(n))
      : [];
    const categories = reorderCategories(orderedIds);
    res.json({categories});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to reorder categories'});
  }
});

categoriesRouter.patch('/categories/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const category = updateCategory(id, {
      name: req.body?.name,
      icon: req.body?.icon,
      isEnabled: req.body?.isEnabled,
      languages:
        req.body?.languages === null || Array.isArray(req.body?.languages)
          ? req.body.languages
          : undefined,
      regions:
        req.body?.regions === null || Array.isArray(req.body?.regions)
          ? req.body.regions
          : undefined,
    });
    res.json({category});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to update category'});
  }
});

categoriesRouter.delete('/categories/:id', (req, res) => {
  try {
    deleteCategory(Number(req.params.id));
    res.json({ok: true});
  } catch (err) {
    res.status(404).json({error: err instanceof Error ? err.message : 'Category not found'});
  }
});

categoriesRouter.post('/tags/suggest', (req, res) => {
  try {
    const tagName = String(req.body?.tagName || '').trim();
    const categoryName = typeof req.body?.categoryName === 'string' ? req.body.categoryName : '';
    const prefs = getPreferences();
    const languages =
      Array.isArray(req.body?.languages) && req.body.languages.length > 0
        ? req.body.languages
        : prefs.languages;
    const preview = previewTagSuggestions(tagName, {categoryName, languages});
    res.json(preview);
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to suggest terms'});
  }
});

categoriesRouter.post('/categories/:id/tags', (req, res) => {
  try {
    const categoryId = Number(req.params.id);
    const tag = createTag({
      categoryId,
      name: String(req.body?.name || ''),
      description: typeof req.body?.description === 'string' ? req.body.description : null,
      priority: req.body?.priority !== undefined ? Number(req.body.priority) : 3,
      expandedTerms: Array.isArray(req.body?.expandedTerms) ? req.body.expandedTerms : undefined,
      exclusions: Array.isArray(req.body?.exclusions) ? req.body.exclusions : [],
      autoExpand: req.body?.autoExpand !== false,
    });
    res.status(201).json({tag});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to create tag'});
  }
});

categoriesRouter.patch('/tags/:id', (req, res) => {
  try {
    const tag = updateTag(Number(req.params.id), {
      name: req.body?.name,
      description: req.body?.description,
      priority: req.body?.priority,
      isEnabled: req.body?.isEnabled,
    });
    res.json({tag});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to update tag'});
  }
});

categoriesRouter.delete('/tags/:id', (req, res) => {
  try {
    deleteTag(Number(req.params.id));
    res.json({ok: true});
  } catch (err) {
    res.status(404).json({error: err instanceof Error ? err.message : 'Tag not found'});
  }
});

categoriesRouter.post('/tags/:id/relations', (req, res) => {
  try {
    const relation = addTagRelation({
      tagId: Number(req.params.id),
      term: String(req.body?.term || ''),
      relationType: req.body?.relationType === 'exclusion' ? 'exclusion' : 'expanded',
    });
    res.status(201).json({relation});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to add tag relation'});
  }
});

categoriesRouter.patch('/tag-relations/:id', (req, res) => {
  try {
    toggleTagRelation(Number(req.params.id), Boolean(req.body?.isEnabled));
    res.json({ok: true});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to toggle relation'});
  }
});

categoriesRouter.delete('/tag-relations/:id', (req, res) => {
  try {
    deleteTagRelation(Number(req.params.id));
    res.json({ok: true});
  } catch (err) {
    res.status(404).json({error: err instanceof Error ? err.message : 'Tag relation not found'});
  }
});
