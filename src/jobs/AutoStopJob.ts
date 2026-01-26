/**
 * Auto-Stop Job
 *
 * Evaluates metrics and automatically stops sending if thresholds are breached.
 *
 * 動作:
 * 1. metrics.ndjson を window_days で集計
 * 2. AutoStopPolicy.evaluate で should_stop 判定
 * 3. should_stop=true なら RuntimeKillSwitch を有効化
 * 4. OPS_STOP_SEND イベントを記録（source="auto_stop"）
 *
 * 重要:
 * - 既に停止中なら何もしない（冪等）
 * - 復旧は人間が resume-send で行う
 */

import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';
import { getAutoStopPolicy, AutoStopMetrics, DailyMetrics } from '../domain/AutoStopPolicy';
import { getRuntimeKillSwitch } from '../domain/RuntimeKillSwitch';

/**
 * Auto-stop job result
 */
export interface AutoStopJobResult {
  executed: boolean;
  should_stop: boolean;
  already_stopped: boolean;
  stopped: boolean;
  reasons: string[];
  metrics: {
    totalSent: number;
    totalReplies: number;
    totalBlocked: number;
    replyRate: number | null;
    blockedRate: number | null;
    consecutiveBadDays: number;
  };
  windowDays: number;
}

/**
 * Auto-stop job options
 */
export interface AutoStopJobOptions {
  dryRun?: boolean;
  now?: Date;
}

/**
 * Run the auto-stop job
 *
 * @param options - Job options
 * @returns Job result
 */
export function runAutoStopJob(options: AutoStopJobOptions = {}): AutoStopJobResult {
  const { dryRun = false, now = new Date() } = options;

  const metricsStore = getMetricsStore();
  const autoStopPolicy = getAutoStopPolicy();
  const runtimeKillSwitch = getRuntimeKillSwitch();
  const config = autoStopPolicy.getConfig();

  // Check if already stopped
  const alreadyStopped = runtimeKillSwitch.isEnabled();
  if (alreadyStopped) {
    const state = runtimeKillSwitch.getState();
    return {
      executed: true,
      should_stop: false,
      already_stopped: true,
      stopped: false,
      reasons: [`Already stopped: ${state?.reason || 'unknown reason'}`],
      metrics: {
        totalSent: 0,
        totalReplies: 0,
        totalBlocked: 0,
        replyRate: null,
        blockedRate: null,
        consecutiveBadDays: 0,
      },
      windowDays: config.window_days,
    };
  }

  // Calculate window start date
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - config.window_days);
  const windowStartStr = windowStart.toISOString();

  // Get events in window
  const events = metricsStore.readEventsSince(windowStartStr);

  // Aggregate metrics
  const aggregatedMetrics = aggregateMetrics(events, config.window_days, now);

  // Evaluate
  const evaluation = autoStopPolicy.evaluate(aggregatedMetrics);

  // If should stop and not dry run, activate kill switch
  let stopped = false;
  if (evaluation.should_stop && !dryRun) {
    runtimeKillSwitch.setEnabled(
      `Auto-stop: ${evaluation.reasons.join('; ')}`,
      'auto_stop'
    );

    // Record OPS_STOP_SEND event with source=auto_stop
    metricsStore.recordOpsStopSend({
      reason: `Auto-stop triggered: ${evaluation.reasons.join('; ')}`,
      setBy: 'auto_stop',
    });

    stopped = true;
  }

  return {
    executed: true,
    should_stop: evaluation.should_stop,
    already_stopped: false,
    stopped,
    reasons: evaluation.reasons,
    metrics: evaluation.metrics,
    windowDays: config.window_days,
  };
}

/**
 * Aggregate metrics from events
 */
function aggregateMetrics(events: MetricsEvent[], windowDays: number, now: Date): AutoStopMetrics {
  const dailyMap = new Map<string, DailyMetrics>();

  // Initialize daily metrics for the window
  for (let i = 0; i < windowDays; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    dailyMap.set(dateStr, {
      date: dateStr,
      attempts: 0,
      success: 0,
      blocked: 0,
      replies: 0,
    });
  }

  let totalAttempts = 0;
  let totalSuccess = 0;
  let totalBlocked = 0;
  let totalReplies = 0;

  for (const event of events) {
    const dateStr = event.timestamp.split('T')[0];
    const daily = dailyMap.get(dateStr);

    switch (event.eventType) {
      case 'AUTO_SEND_ATTEMPT':
        totalAttempts++;
        if (daily) daily.attempts++;
        break;
      case 'AUTO_SEND_SUCCESS':
        totalSuccess++;
        if (daily) daily.success++;
        break;
      case 'AUTO_SEND_BLOCKED':
        totalBlocked++;
        if (daily) daily.blocked++;
        break;
      case 'REPLY_DETECTED':
        totalReplies++;
        if (daily) daily.replies++;
        break;
    }
  }

  // Convert daily map to array, sorted by date descending
  const dailyMetrics = Array.from(dailyMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  return {
    totalAttempts,
    totalSuccess,
    totalBlocked,
    totalReplies,
    dailyMetrics,
  };
}

export { aggregateMetrics };
