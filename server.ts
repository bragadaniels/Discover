import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import {createServer as createViteServer} from 'vite';
import {APP_CONFIG} from './server/config';
import {startDiscoveryScheduler} from './server/core/scheduler';
import {getDb} from './server/db/database';
import {archivesRouter} from './server/routes/archives';
import {categoriesRouter} from './server/routes/categories';
import {discoveryRouter} from './server/routes/discovery';
import {feedRouter} from './server/routes/feed';
import {notesRouter} from './server/routes/notes';
import {settingsRouter} from './server/routes/settings';

async function startServer() {
  // Initialize SQLite database & schema before accepting requests
  getDb();

  const app = express();
  app.use(express.json({limit: '4mb'}));

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok'});
  });

  app.use('/api', categoriesRouter);
  app.use('/api', feedRouter);
  app.use('/api', discoveryRouter);
  app.use('/api', settingsRouter);
  app.use('/api', archivesRouter);
  app.use('/api', notesRouter);

  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: {server: httpServer},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(APP_CONFIG.port, '0.0.0.0', () => {
    console.log(`Discover server listening on http://localhost:${APP_CONFIG.port}`);
    startDiscoveryScheduler();
  });
}

startServer().catch((err) => {
  console.error('Failed to start Discover server:', err);
  process.exit(1);
});
