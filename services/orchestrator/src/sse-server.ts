// SSE endpoints for the live dashboard. POST /api/notify lets the agents
// and provider processes push their events into the same stream.

import { Request, Response, Router } from 'express';
import { eventBus, SwarmEvent } from './event-bus.ts';

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds

export const sseRouter = Router();

// Active SSE connections
let connectionCount = 0;

/** GET /api/live/stream - SSE event stream */
sseRouter.get('/api/live/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  connectionCount++;
  console.log(`[sse] Client connected (total: ${connectionCount})`);

  // Send initial state
  const initialData = {
    type: 'init',
    stats: eventBus.getStats(),
    recentEvents: eventBus.getRecentEvents(20),
  };
  res.write(`data: ${JSON.stringify(initialData)}\n\n`);

  // Subscribe to swarm events
  const onEvent = (event: SwarmEvent) => {
    try {
      res.write(`event: protocol-event\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected
    }
  };
  eventBus.on('protocol-event', onEvent);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(
        `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now(), connections: connectionCount })}\n\n`,
      );
    } catch {
      clearInterval(heartbeat);
    }
  }, HEARTBEAT_INTERVAL);

  // Cleanup on disconnect
  req.on('close', () => {
    connectionCount--;
    clearInterval(heartbeat);
    eventBus.off('protocol-event', onEvent);
    console.log(`[sse] Client disconnected (total: ${connectionCount})`);
  });
});

/** GET /api/live/events - Get recent events (REST fallback) */
sseRouter.get('/api/live/events', (_req: Request, res: Response) => {
  const limit = Number(_req.query.limit) || 50;
  res.json({
    events: eventBus.getRecentEvents(limit),
    stats: eventBus.getStats(),
    connections: connectionCount,
  });
});

/** GET /api/live/stats - Get swarm stats */
sseRouter.get('/api/live/stats', (_req: Request, res: Response) => {
  res.json({
    stats: eventBus.getStats(),
    connections: connectionCount,
    timestamp: Date.now(),
  });
});

/** POST /api/notify - other processes push their events into this stream */
sseRouter.post('/api/notify', (req: Request, res: Response) => {
  try {
    const { type, data } = req.body;
    if (!type || !data) {
      return res.status(400).json({ error: 'Missing type or data' });
    }

    eventBus.emitEvent({
      type: type as SwarmEvent['type'],
      data,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
