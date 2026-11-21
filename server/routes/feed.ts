import {Router} from 'express';
import type {CategorySelection, FeedFilterType, SortOption} from '../../shared/types';
import {runLiveWebSearch} from '../core/discovery_engine';
import {getFeedCounts, getItemsByIds, queryFeed, updateContentFeedback} from '../services/feed_service';

export const feedRouter = Router();

feedRouter.get('/feed', (req, res) => {
  try {
    const rawCat = req.query.categoryId;
    const categoryId: CategorySelection =
      rawCat === 'lucky'
        ? 'lucky'
        : rawCat && rawCat !== 'all' && Number.isFinite(Number(rawCat))
          ? Number(rawCat)
          : 'all';

    const filter = (typeof req.query.filter === 'string' ? req.query.filter : 'all') as FeedFilterType;
    const sort = (typeof req.query.sort === 'string' ? req.query.sort : 'relevant') as SortOption;
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const language = typeof req.query.language === 'string' ? req.query.language : 'all';
    const luckySeed = Number(req.query.luckySeed) || 0;
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 24;

    const result = queryFeed({categoryId, filter, sort, search, language, luckySeed, page, pageSize});
    const counts = getFeedCounts(categoryId);
    res.json({...result, counts});
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Failed to load feed'});
  }
});

feedRouter.post('/feed/live-search', async (req, res) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({error: 'Search query is required'});
      return;
    }
    const language = typeof req.body?.language === 'string' ? req.body.language : 'all';
    const sort = (typeof req.body?.sort === 'string' ? req.body.sort : 'newest') as SortOption;
    const filter = (typeof req.body?.filter === 'string' ? req.body.filter : 'all') as FeedFilterType;

    const searchResult = await runLiveWebSearch({query, language});
    const items = getItemsByIds(searchResult.itemIds, {sort, filter, language});
    res.json({
      items,
      total: items.length,
      errors: searchResult.errors,
    });
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Live search failed'});
  }
});

feedRouter.patch('/content/:id/feedback', (req, res) => {
  try {
    const contentId = Number(req.params.id);
    if (!Number.isFinite(contentId)) {
      res.status(400).json({error: 'Invalid content ID'});
      return;
    }

    const updated = updateContentFeedback(contentId, {
      feedbackType:
        req.body?.feedbackType === 'like' ||
        req.body?.feedbackType === 'dislike' ||
        req.body?.feedbackType === null
          ? req.body.feedbackType
          : undefined,
      isRead: typeof req.body?.isRead === 'boolean' ? req.body.isRead : undefined,
      isSaved: typeof req.body?.isSaved === 'boolean' ? req.body.isSaved : undefined,
      isHidden: typeof req.body?.isHidden === 'boolean' ? req.body.isHidden : undefined,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to update feedback'});
  }
});
