import {Router} from 'express';
import {
  getProviderHealthMetrics,
  getProviderStatusList,
  getRecentDiscoveryLogs,
  isDiscoveryRunning,
  runDiscovery,
  setProviderEnabled,
} from '../core/discovery_engine';

export const discoveryRouter = Router();

discoveryRouter.get('/discovery/status', (_req, res) => {
  res.json({
    isRunning: isDiscoveryRunning(),
    providers: getProviderStatusList(),
    providerHealth: getProviderHealthMetrics(),
    recentLogs: getRecentDiscoveryLogs(25),
  });
});

discoveryRouter.post('/discovery/run', async (req, res) => {
  try {
    const categoryId =
      req.body?.categoryId && Number.isFinite(Number(req.body.categoryId))
        ? Number(req.body.categoryId)
        : undefined;
    const force = req.body?.force !== false;
    const summary = await runDiscovery({categoryId, force});
    res.json({summary});
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Discovery run failed'});
  }
});

discoveryRouter.patch('/providers/:name', (req, res) => {
  try {
    setProviderEnabled(req.params.name, Boolean(req.body?.isEnabled));
    res.json({providers: getProviderStatusList()});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to update provider'});
  }
});
