const { createClient } = require('@supabase/supabase-js');

const loggedRequestMetadata = new Set();

function assertEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function fetchJson(url, options = {}) {
  const headers = {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const requestKey = `${response.url}::${options.method || 'GET'}`;
  const requestId = response.headers.get('x-github-request-id');
  const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
  const rateLimitReset = response.headers.get('x-ratelimit-reset');
  const oauthScopes = response.headers.get('x-oauth-scopes');
  const linkHeader = response.headers.get('link');
  const resource = url.replace('https://api.github.com', '');

  if (!loggedRequestMetadata.has(requestKey)) {
    loggedRequestMetadata.add(requestKey);
    console.log(`[GitHub] ${options.method || 'GET'} ${resource} -> ${response.status}`);
    console.log(`         request-id=${requestId || 'unknown'} remaining=${rateLimitRemaining || 'unknown'} reset=${rateLimitReset || 'unknown'} scopes=${oauthScopes || 'unknown'}`);
    if (linkHeader) {
      console.log(`         pagination=${linkHeader}`);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  return response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withIsoTimestamp(dateLike) {
  if (!dateLike) return null;
  const date = new Date(dateLike);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {number} attempt
 */
function getDelayForAttempt(attempt) {
  if (attempt <= 6) return 5000;
  if (attempt <= 12) return 10000;
  if (attempt <= 24) return 20000;
  if (attempt <= 36) return 30000;
  return 45000;
}

function getJitteredDelay(attempt) {
  const base = getDelayForAttempt(attempt);
  const jitter = Math.floor(Math.random() * Math.min(2000, base * 0.15));
  return base + jitter;
}

function extractPreviewUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s>\)]+/i);
  if (!match) return null;
  const cleaned = match[0].replace(/[)\]\s]*$/, '');
  return cleaned.includes('.pages.dev') ? cleaned : match[0];
}

const CLOUDFLARE_APP_IDENTIFIERS = [
  'cloudflare-workers-and-pages',
  'cloudflare-pages',
  'cloudflare-pages[bot]',
];

/**
 * @typedef {Object} PreviewDiscovery
 * @property {string} url
 * @property {string} source
 * @property {string|null} detectedAtIso
 * @property {Record<string, any>} [metadata]
 */

/**
 * @param {string} baseUrl
 * @param {string} commitSha
 * @returns {Promise<PreviewDiscovery|null>}
 */
async function tryCheckRunPreview(baseUrl, commitSha) {
  const checkRunsUrl = `${baseUrl}/commits/${commitSha}/check-runs`;
  const { check_runs: checkRuns = [] } = await fetchJson(checkRunsUrl);
  console.log(`Fetched ${checkRuns.length} check-runs for commit ${commitSha}.`);
  checkRuns.slice(0, 5).forEach((run) => {
    const appSlug = run.app?.slug || run.app?.name || 'unknown-app';
    console.log(`  • Check-run ${run.id} (${run.name}) from ${appSlug} status=${run.status} conclusion=${run.conclusion}`);
  });

  const cfCheckRun = checkRuns.find((run) => {
    const appSlug = run.app?.slug?.toLowerCase() || '';
    return CLOUDFLARE_APP_IDENTIFIERS.includes(appSlug);
  });

  if (!cfCheckRun) {
    console.log('No Cloudflare Pages check-run found yet.');
    return null;
  }

  console.log(`Cloudflare Pages check-run status: ${cfCheckRun.status}; conclusion: ${cfCheckRun.conclusion || 'pending'}`);

  if (cfCheckRun.status === 'completed' && cfCheckRun.conclusion && ['success', 'neutral'].includes(cfCheckRun.conclusion)) {
    const possibleSources = [
      cfCheckRun.output?.summary,
      cfCheckRun.output?.text,
      cfCheckRun.output?.title,
      cfCheckRun.details_url,
    ];

    for (const source of possibleSources) {
      const url = extractPreviewUrl(source);
      if (url) {
        console.log('Extracted preview URL from Cloudflare check-run.');
        return {
          url,
          source: 'check_run',
          detectedAtIso: withIsoTimestamp(cfCheckRun.completed_at || cfCheckRun.updated_at),
          metadata: {
            checkRunId: cfCheckRun.id,
            checkRunName: cfCheckRun.name,
            appSlug: cfCheckRun.app?.slug || cfCheckRun.app?.name || null,
          },
        };
      }
    }
  }

  return null;
}

/**
 * @param {string} baseUrl
 * @param {string} commitSha
 * @returns {Promise<PreviewDiscovery|null>}
 */
async function tryStatusPreview(baseUrl, commitSha) {
  const statusesUrl = `${baseUrl}/commits/${commitSha}/statuses?per_page=100`;
  const statuses = await fetchJson(statusesUrl);
  console.log(`Fetched ${statuses.length} commit statuses for ${commitSha}.`);
  statuses.slice(0, 5).forEach((status) => {
    const context = status.context || 'unknown-context';
    const state = status.state || 'unknown-state';
    const creator = status.creator?.login || 'unknown-user';
    console.log(`  • Status ${status.id} context="${context}" state=${state} by ${creator}`);
  });

  const cfStatus = statuses.find((status) => {
    const context = (status.context || '').toLowerCase();
    return context.includes('cloudflare') || context.includes('pages');
  });

  if (!cfStatus) {
    console.log('No Cloudflare-like commit status found yet.');
    return null;
  }

  const possibleSources = [cfStatus.target_url, cfStatus.description, cfStatus.context];
  for (const source of possibleSources) {
    const url = extractPreviewUrl(source);
    if (url) {
      console.log('Extracted preview URL from commit status.');
      return {
        url,
        source: 'commit_status',
        detectedAtIso: withIsoTimestamp(cfStatus.updated_at),
        metadata: {
          statusId: cfStatus.id,
          context: cfStatus.context,
        },
      };
    }
  }

  console.log('Cloudflare-like status located but did not contain a preview URL.');
  return null;
}

/**
 * @param {string} baseUrl
 * @param {number} prNumber
 * @returns {Promise<PreviewDiscovery|null>}
 */
async function tryCommentPreview(baseUrl, prNumber) {
  const commentsUrl = `${baseUrl}/issues/${prNumber}/comments?per_page=100`;
  const comments = await fetchJson(commentsUrl);
  console.log(`Fetched ${comments.length} issue comments for PR #${prNumber}.`);
  comments.slice(-5).forEach((comment) => {
    const login = comment.user?.login || 'unknown-user';
    console.log(`  • Comment ${comment.id} by ${login} at ${comment.created_at}`);
  });
  const cfComment = [...comments]
    .reverse()
    .find((comment) => {
      const login = comment.user?.login || '';
      return CLOUDFLARE_APP_IDENTIFIERS.includes(login.toLowerCase());
    });

  if (!cfComment) {
    console.log('Cloudflare deployment comment not found yet.');
    return null;
  }

  const url = extractPreviewUrl(cfComment.body);
  if (url) {
    console.log('Extracted preview URL from Cloudflare deployment comment.');
    return {
      url,
      source: 'issue_comment',
      detectedAtIso: withIsoTimestamp(cfComment.created_at),
      metadata: {
        commentId: cfComment.id,
      },
    };
  }

  console.log('Cloudflare comment located but did not contain a preview URL.');
  return null;
}

/**
 * @param {string} baseUrl
 * @param {number} prNumber
 * @returns {Promise<PreviewDiscovery|null>}
 */
async function tryTimelinePreview(baseUrl, prNumber) {
  const timelineUrl = `${baseUrl}/issues/${prNumber}/timeline?per_page=100`;
  const events = await fetchJson(timelineUrl, {
    headers: {
      Accept: 'application/vnd.github.mockingbird-preview+json',
    },
  });
  console.log(`Fetched ${events.length} timeline events for PR #${prNumber}.`);

  const timelineComment = [...events]
    .reverse()
    .find((event) => {
      const login = event.actor?.login || '';
      const body = event.body || '';
      const isCloudflareActor = CLOUDFLARE_APP_IDENTIFIERS.includes(login.toLowerCase());
      return event.event === 'commented' && isCloudflareActor && extractPreviewUrl(body);
    });

  if (!timelineComment) {
    console.log('Cloudflare timeline event with preview URL not found yet.');
    return null;
  }

  const url = extractPreviewUrl(timelineComment.body);
  if (url) {
    console.log('Extracted preview URL from PR timeline event.');
    return {
      url,
      source: 'timeline',
      detectedAtIso: withIsoTimestamp(timelineComment.created_at),
      metadata: {
        eventId: timelineComment.id,
      },
    };
  }

  console.log('Cloudflare timeline event located but did not contain a preview URL.');
  return null;
}

/**
 * @param {string} baseUrl
 * @param {number} prNumber
 * @returns {Promise<PreviewDiscovery|null>}
 */
async function tryReviewPreview(baseUrl, prNumber) {
  const reviewsUrl = `${baseUrl}/pulls/${prNumber}/reviews?per_page=100`;
  const reviews = await fetchJson(reviewsUrl);
  console.log(`Fetched ${reviews.length} pull request reviews for PR #${prNumber}.`);

  const cfReview = [...reviews]
    .reverse()
    .find((review) => {
      const login = review.user?.login || '';
      return CLOUDFLARE_APP_IDENTIFIERS.includes(login.toLowerCase()) && extractPreviewUrl(review.body);
    });

  if (cfReview) {
    const url = extractPreviewUrl(cfReview.body);
    if (url) {
      console.log('Extracted preview URL from PR review body.');
      return {
        url,
        source: 'review',
        detectedAtIso: withIsoTimestamp(cfReview.submitted_at || cfReview.updated_at),
        metadata: {
          reviewId: cfReview.id,
        },
      };
    }
  }

  const reviewCommentsUrl = `${baseUrl}/pulls/${prNumber}/comments?per_page=100`;
  const reviewComments = await fetchJson(reviewCommentsUrl);
  console.log(`Fetched ${reviewComments.length} review comments for PR #${prNumber}.`);

  const cfReviewComment = [...reviewComments]
    .reverse()
    .find((comment) => {
      const login = comment.user?.login || '';
      return CLOUDFLARE_APP_IDENTIFIERS.includes(login.toLowerCase()) && extractPreviewUrl(comment.body);
    });

  if (cfReviewComment) {
    const url = extractPreviewUrl(cfReviewComment.body);
    if (url) {
      console.log('Extracted preview URL from review comment.');
      return {
        url,
        source: 'review_comment',
        detectedAtIso: withIsoTimestamp(cfReviewComment.created_at),
        metadata: {
          commentId: cfReviewComment.id,
        },
      };
    }
  }

  console.log('Cloudflare review artifacts not found yet.');
  return null;
}

async function getPreviewDetails(prNumber, commitSha, metrics) {
  console.log(`\nPolling for Cloudflare preview URL for commit: ${commitSha}...`);
  const maxRetries = Number(process.env.PREVIEW_MAX_RETRIES || 60);
  const repo = process.env.GITHUB_REPOSITORY;
  const baseUrl = `https://api.github.com/repos/${repo}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`\n--- Poll attempt ${attempt}/${maxRetries} ---`);
    metrics.pollAttempts = attempt;

    try {
      const fromCheckRun = await tryCheckRunPreview(baseUrl, commitSha);
      if (fromCheckRun) {
        console.log(`\n✅ Success! Found preview URL via check-run: ${fromCheckRun.url}`);
        return { discovery: fromCheckRun, attempt };
      }
    } catch (error) {
      console.log(`Check-run polling error: ${error.message}`);
      metrics.pollErrors += 1;
    }

    try {
      const fromStatuses = await tryStatusPreview(baseUrl, commitSha);
      if (fromStatuses) {
        console.log(`\n✅ Success! Found preview URL via commit status: ${fromStatuses.url}`);
        return { discovery: fromStatuses, attempt };
      }
    } catch (error) {
      console.log(`Status polling error: ${error.message}`);
      metrics.pollErrors += 1;
    }

    try {
      const fromComments = await tryCommentPreview(baseUrl, prNumber);
      if (fromComments) {
        console.log(`\n✅ Success! Found preview URL via PR comment: ${fromComments.url}`);
        return { discovery: fromComments, attempt };
      }
    } catch (error) {
      console.log(`Comment polling error: ${error.message}`);
      metrics.pollErrors += 1;
    }

    try {
      const fromTimeline = await tryTimelinePreview(baseUrl, prNumber);
      if (fromTimeline) {
        console.log(`\n✅ Success! Found preview URL via PR timeline: ${fromTimeline.url}`);
        return { discovery: fromTimeline, attempt };
      }
    } catch (error) {
      console.log(`Timeline polling error: ${error.message}`);
      metrics.pollErrors += 1;
    }

    try {
      const fromReviews = await tryReviewPreview(baseUrl, prNumber);
      if (fromReviews) {
        console.log(`\n✅ Success! Found preview URL via PR review: ${fromReviews.url}`);
        return { discovery: fromReviews, attempt };
      }
    } catch (error) {
      console.log(`Review polling error: ${error.message}`);
      metrics.pollErrors += 1;
    }

    const delayMs = getJitteredDelay(attempt);
    console.log(`Preview URL not available yet. Waiting ${(delayMs / 1000).toFixed(1)} seconds before next attempt...`);
    metrics.scheduledWaitMs += delayMs;
    await delay(delayMs);
  }

  throw new Error('Timed out waiting for the Cloudflare Pages preview URL.');
}

async function main() {
  const GH_TOKEN = assertEnv('GH_TOKEN');
  const SUPABASE_URL = assertEnv('SUPABASE_URL');
  const SUPABASE_ANON_KEY = assertEnv('SUPABASE_ANON_KEY');
  const PR_NUMBER_RAW = assertEnv('PR_NUMBER');
  const PR_URL = assertEnv('PR_URL');
  const COMMIT_SHA = assertEnv('COMMIT_SHA');

  if (!process.env.GITHUB_REPOSITORY) {
    throw new Error('Missing GITHUB_REPOSITORY in environment.');
  }

  console.log(`Processing PR #${PR_NUMBER_RAW} (${PR_URL}) for commit ${COMMIT_SHA}`);

  const prNumber = parseInt(PR_NUMBER_RAW, 10);
  if (Number.isNaN(prNumber)) {
    throw new Error(`PR_NUMBER is not a valid integer: ${PR_NUMBER_RAW}`);
  }

  const metrics = {
    pollAttempts: 0,
    pollErrors: 0,
    scheduledWaitMs: 0,
  };

  const repo = process.env.GITHUB_REPOSITORY;
  const baseUrl = `https://api.github.com/repos/${repo}`;

  const prDetails = await fetchJson(`${baseUrl}/pulls/${prNumber}`);
  const prOpenedAtIso = withIsoTimestamp(prDetails.created_at);
  console.log(`[Metrics] pr_opened_at=${prOpenedAtIso || 'unknown'} pr_number=${prNumber}`);

  const pollStartedAt = new Date();
  console.log(`[Metrics] poll_started_at=${pollStartedAt.toISOString()}`);

  const { discovery, attempt } = await getPreviewDetails(prNumber, COMMIT_SHA, metrics);
  const detectionLoggedAt = new Date();
  const detectedAt = discovery.detectedAtIso ? new Date(discovery.detectedAtIso) : detectionLoggedAt;
  const detectionLatencyMs = Math.max(0, detectionLoggedAt.getTime() - detectedAt.getTime());
  const pollDurationMs = Math.max(0, detectionLoggedAt.getTime() - pollStartedAt.getTime());

  console.log(`[Metrics] preview_detected_at=${discovery.detectedAtIso || detectionLoggedAt.toISOString()} source=${discovery.source} attempt=${attempt}`);
  console.log(`[Metrics] poll_cycles_per_preview=${attempt}`);
  console.log(`[Metrics] poll_errors=${metrics.pollErrors}`);
  console.log(`[Metrics] wait_time_total_ms=${metrics.scheduledWaitMs}`);
  console.log(`[Metrics] detection_latency_ms=${detectionLatencyMs}`);
  console.log(`[Metrics] poll_total_runtime_ms=${pollDurationMs}`);

  console.log('Updating Supabase with build record...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await supabase.from('preview_builds').insert([
    {
      pr_number: prNumber,
      pr_url: PR_URL,
      commit_sha: COMMIT_SHA,
      preview_url: discovery.url,
      status: 'pending_review',
      is_seen: false,
      run_id: process.env.GITHUB_RUN_ID ? parseInt(process.env.GITHUB_RUN_ID, 10) : null,
      build_number: null,
    },
  ]);

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  const insertCompletedAt = new Date();
  console.log(`[Metrics] supabase_insert_completed_at=${insertCompletedAt.toISOString()}`);
  const cfToInsertMs = Math.max(0, insertCompletedAt.getTime() - detectedAt.getTime());
  console.log(`[Metrics] cf_complete_to_insert_ms=${cfToInsertMs}`);
  console.log('✅ Preview record stored successfully.');
}

main().catch((error) => {
  console.error('Failed to record preview for PR:', error);
  process.exit(1);
});

