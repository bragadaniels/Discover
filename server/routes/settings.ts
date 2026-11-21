import {Router} from 'express';
import {exportWorkspaceBackup, importWorkspaceBackup} from '../services/backup_service';
import {
  addCustomLanguage,
  addCustomRegion,
  getPreferences,
  removeCustomLanguage,
  removeCustomRegion,
  updatePreferences,
} from '../services/preference_service';

export const settingsRouter = Router();

settingsRouter.get('/preferences', (_req, res) => {
  res.json({preferences: getPreferences()});
});

settingsRouter.patch('/preferences', (req, res) => {
  try {
    const preferences = updatePreferences(req.body || {});
    res.json({preferences});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to update preferences'});
  }
});

settingsRouter.post('/preferences/custom-languages', (req, res) => {
  try {
    const preferences = addCustomLanguage({
      code: String(req.body?.code || ''),
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
    });
    res.status(201).json({preferences});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to add custom language'});
  }
});

settingsRouter.delete('/preferences/custom-languages/:code', (req, res) => {
  try {
    const preferences = removeCustomLanguage(String(req.params.code || ''));
    res.json({preferences});
  } catch (err) {
    res.status(404).json({error: err instanceof Error ? err.message : 'Failed to remove custom language'});
  }
});

settingsRouter.post('/preferences/custom-regions', (req, res) => {
  try {
    const preferences = addCustomRegion({
      code: typeof req.body?.code === 'string' ? req.body.code : undefined,
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
      countryCode: typeof req.body?.countryCode === 'string' ? req.body.countryCode : undefined,
      defaultLanguage:
        typeof req.body?.defaultLanguage === 'string' ? req.body.defaultLanguage : undefined,
      queryLocation:
        typeof req.body?.queryLocation === 'string' ? req.body.queryLocation : undefined,
    });
    res.status(201).json({preferences});
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Failed to add custom region'});
  }
});

settingsRouter.delete('/preferences/custom-regions/:code', (req, res) => {
  try {
    const preferences = removeCustomRegion(String(req.params.code || ''));
    res.json({preferences});
  } catch (err) {
    res.status(404).json({error: err instanceof Error ? err.message : 'Failed to remove custom region'});
  }
});

settingsRouter.get('/backup/export', (_req, res) => {
  const backup = exportWorkspaceBackup();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="discover-backup.json"');
  res.send(JSON.stringify(backup, null, 2));
});

settingsRouter.post('/backup/import', (req, res) => {
  try {
    const result = importWorkspaceBackup(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({error: err instanceof Error ? err.message : 'Backup import failed'});
  }
});
