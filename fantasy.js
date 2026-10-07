const API_URL =
  'https://script.google.com/macros/s/AKfycbzKMV9Vy3fq2UQlT8Z5Ll67gsEieLE1EhrFQ13hnENcNzp2FOX-2lBv402tSvivKeriOg/exec';

const FantasyPerf = (() => {
  const navStart = performance.timeOrigin || Date.now();
  let seq = 0;

  function nowFromNav() {
    return performance.now();
  }

  function log(message, data = {}) {
    console.log(`[FantasyPerf] ${message}`, data);
  }

  function start(label, data = {}) {
    const id = ++seq;
    const started = performance.now();

    log(`▶ ${label} #${id}`, data);

    return {
      id,
      end(extra = {}) {
        const durationMs = performance.now() - started;
        log(`✓ ${label} #${id}: ${durationMs.toFixed(1)} ms`, {
          durationMs: Number(durationMs.toFixed(1)),
          ...extra
        });
        return durationMs;
      },
      fail(error, extra = {}) {
        const durationMs = performance.now() - started;
        log(`✗ ${label} #${id}: ${durationMs.toFixed(1)} ms`, {
          durationMs: Number(durationMs.toFixed(1)),
          error: error && error.message ? error.message : String(error),
          ...extra
        });
        return durationMs;
      }
    };
  }

  return {
    log,
    start,
    nowFromNav
  };
})();

FantasyPerf.log(
  `JS executing at ${FantasyPerf.nowFromNav().toFixed(1)} ms after navigation start`
);

document.addEventListener('DOMContentLoaded', () => {
  FantasyPerf.log(
    `DOMContentLoaded fired at ${FantasyPerf.nowFromNav().toFixed(1)} ms after navigation start`
  );
}, { once: true });

window.addEventListener('load', () => {
  FantasyPerf.log(
    `window.load at ${FantasyPerf.nowFromNav().toFixed(1)} ms after navigation start`
  );
}, { once: true });

const CUSTOM_TEAM_ICONS = Object.freeze({
  1: 'assets/teams/main-event-dante.png',
  2: 'assets/teams/iambad2.png',
  3: 'assets/teams/brittanys-brilliant-team.png',
  4: 'assets/teams/cheetahs-and-cleats.png',
  5: 'assets/teams/baby-back-gibbs.png',
  6: 'assets/teams/devins-dawg-pound.png',
  7: 'assets/teams/caleb-days-dynasty.png',
  8: 'assets/teams/here-comes-the-boom.png',
  9: 'assets/teams/go-birds.png',
  10: 'assets/teams/canadian-football-league.png',
  11: 'assets/teams/740-bad-dads-club.png',
  12: 'assets/teams/jeremys-scary-team.png'
});

/*
 * Manual storylines.
 *
 * Key format:
 *   "week:lowerTeamId-higherTeamId"
 *
 * This is intentionally manual so "Match of the Week" means something.
 * Add future rivalries, rematches, playoff revenge games, etc. here.
 */

const LOADER_MINIMUM_MS = 1100;
const LEAGUE_BROWSER_CACHE_KEY = 'ZENNI_FANTASY_LEAGUE_LAST_GOOD_V1';
const LEAGUE_BROWSER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LEAGUE_RETRY_DELAYS_MS = [1200, 2800];

const loaderState = {
  startedAt: Date.now(),
  minimumMs: LOADER_MINIMUM_MS,
  disabled: false,
  note: null,
  progress: 0,
  target: 8,
  timer: null,
  stages: [
    { at: 8,  text: 'Initializing Zenni League', message: 'Preparing the championship stage...' },
    { at: 24, text: 'Connecting to ESPN', message: 'Connecting to ESPN Fantasy...' },
    { at: 44, text: 'Loading teams', message: 'Loading all 12 teams...' },
    { at: 62, text: 'Syncing matchups', message: 'Syncing weekly matchups...' },
    { at: 78, text: 'Preparing Battle Center', message: 'Preparing the Battle Center...' },
    { at: 90, text: 'Finalizing league', message: 'The road to the championship is ready...' }
  ]
};

const MATCHUP_STORYLINES = Object.freeze({
  '1:1-6': {
    featured: true,
    eyebrow: '2025 Zenni Cup Championship Rematch',
    title: 'THE REMATCH',
    subtitle: 'Main Event Dante vs Devin’s Dawg Pound',
    reason: 'The 2026 season opens with a rematch of last year’s championship matchup. Dante enters as the defending champion; Devin gets the first shot at revenge.',
    tag: 'Championship Rematch'
  }
});

const battleAnimationState = {
  timer: null,
  sequenceTimer: null,
  activeStage: null,
  cycle: 0
};

const state = {
  league: null,
  teams: [],
  teamMap: new Map(),
  standings: [],
  currentMatchups: [],
  selectedWeek: 1,
  weekCache: new Map(),
  playerPerformanceCache: new Map(),
  weekRosterCache: new Map(),
  weekPerformanceCache: new Map(),
  awardsRequestToken: 0,
  teamGradeCache: new Map(),
  performerRequestToken: 0,
  topPerformerPosition: 'ALL',
  awardsWeek: 1,
  gradesWeek: 1,
  awardsPerformerPosition: 'ALL',
  allTimePerformerPosition: 'ALL',
  allTimePerformanceCache: null,
  allTimeRequestToken: 0,
  allTimeMissingWeeks: [],
  teamGradeRequestToken: 0,
  activeView: 'overview',
  draft: null,
  draftCountdownTimer: null,
  draftRound: 1,
  draftSelectedTeamId: null,
  battleCastCache: new Map(),
  battleCastTimer: null,
  battleCastLoading: false,
  battleCastSelectedKey: null,
  battleCastOpen: true,
  battleCastRequestSeq: 0,
  scoreSyncTimer: null,

  // Resilience layer
  draftLoadState: 'idle',
  pollingEnabled: false,
  lastScoreRefreshAt: 0,
  scoresStale: false,
  leagueDegraded: false,
  revalidateAttempts: 0,
  visibilityBound: false,
  seasonBoardKey: null,
  seasonBoardTimer: null,

  // Weekly recap
  recap: null,
  recapToken: 0,
  recapForced: false,
  recapAnimatedWeek: null,
  recapCountdownTimer: null,
  matchupsResolved: false,
  kickoffMs: null,
  kickoffFetchedAt: 0,

  // Live motion + freshness
  scoreMemory: new Map(),
  castMemory: new Map(),
  castPlayerMemory: new Map(),
  toastQueue: [],
  toastShowing: false,
  motionQuietUntil: 0,
  lastSyncAt: 0,
  freshnessTimer: null,

  // My team + sharing
  myWeekRecap: null,
  myWeekLoading: null,
  myWeekTimer: null,
  shareUrl: null,
  shareFile: null
};

/* =========================================================
   WEEKLY RECAP
   Shown on the Overview from the moment a week is final until the next
   week's first game starts. Everything is computed from numbers the site
   already trusts (resolved matchups + weekly starters). No generated text.
   ========================================================= */

const RECAP_CACHE_PREFIX = 'ZENNI_FANTASY_RECAP_V2_';   // bumped: recap data gained bench + high/low
const RECAP_LATEST_TTL_MS = 2 * 60 * 60 * 1000;
const RECAP_OLD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RECAP_KICKOFF_REFRESH_MS = 10 * 60 * 1000;

function recapOrdinal_(n) {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = Number(n) % 100;
  return Number(n) + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

function recapJoinNames_(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function recapTeamName_(id) {
  const team = state.teamMap.get(Number(id));
  return team ? team.name : `Team ${id}`;
}

function recapRecordText_(team) {
  if (!team) return '';
  const ties = Number(team.ties || 0);
  return `${Number(team.wins || 0)}-${Number(team.losses || 0)}${ties ? `-${ties}` : ''}`;
}

/**
 * Which week should the recap describe, and should it be showing?
 *   recap : the week is over and the next one has not started
 *   live  : a newer week is already under way
 *   none  : nothing has finished yet (Week 1)
 */
function getRecapContext_() {
  if (!state.league) return null;

  const current = Number(state.league.currentWeek || 1);
  const statuses = (Array.isArray(state.currentMatchups) ? state.currentMatchups : [])
    .map(match => String(match && match.status || '').toUpperCase());

  const allFinal = statuses.length > 0 && statuses.every(status => status === 'FINAL');
  const allScheduled = statuses.length > 0 && statuses.every(status => status === 'SCHEDULED');

  // ESPN has not rolled to the next week yet, but every game is final.
  if (allFinal) return { week: current, mode: 'recap', current };

  if (current > 1) {
    return { week: current - 1, mode: allScheduled ? 'recap' : 'live', current };
  }

  return { week: null, mode: 'none', current };
}

/**
 * PURE: builds every recap fact from matchups + weekly rosters.
 * No DOM, no state reads, safe to cache as JSON.
 */
function buildWeekRecap_(input) {
  const week = Number(input.week);
  const games = (Array.isArray(input.matchups) ? input.matchups : [])
    .filter(match => match && match.homeTeamId && match.awayTeamId);
  const snapshots = Array.isArray(input.snapshots) ? input.snapshots : [];

  const rosterByTeam = new Map(
    snapshots.map(snapshot => [Number(snapshot.team.id), Array.isArray(snapshot.roster) ? snapshot.roster : []])
  );

  const complete = games.length > 0 &&
    games.every(match => String(match.status || '').toUpperCase() === 'FINAL');

  const rows = [];
  const pairs = [];

  games.forEach(match => {
    const homeScore = Number(match.homeScore || 0);
    const awayScore = Number(match.awayScore || 0);
    const margin = Math.abs(homeScore - awayScore);
    const tie = homeScore === awayScore;
    const homeWins = homeScore >= awayScore;

    rows.push({
      teamId: Number(match.homeTeamId), opponentId: Number(match.awayTeamId),
      matchupId: Number(match.matchupId || 0), score: homeScore, opponentScore: awayScore,
      result: tie ? 'T' : homeScore > awayScore ? 'W' : 'L', margin
    });
    rows.push({
      teamId: Number(match.awayTeamId), opponentId: Number(match.homeTeamId),
      matchupId: Number(match.matchupId || 0), score: awayScore, opponentScore: homeScore,
      result: tie ? 'T' : awayScore > homeScore ? 'W' : 'L', margin
    });

    pairs.push({
      matchupId: Number(match.matchupId || 0),
      homeTeamId: Number(match.homeTeamId), awayTeamId: Number(match.awayTeamId),
      homeScore, awayScore, tie, margin, combined: homeScore + awayScore,
      winnerId: Number(homeWins ? match.homeTeamId : match.awayTeamId),
      loserId: Number(homeWins ? match.awayTeamId : match.homeTeamId),
      winnerScore: homeWins ? homeScore : awayScore,
      loserScore: homeWins ? awayScore : homeScore
    });
  });

  // League-wide scoring rank for the week (same tie-break as the Grades tab).
  rows.slice()
    .sort((a, b) => b.score - a.score || a.teamId - b.teamId)
    .forEach((row, index) => { row.rank = index + 1; });

  rows.forEach(row => {
    row.efficiency = null;
    row.projectionRatio = null;
    row.optimal = null;
    row.benchGap = 0;
    row.couldHaveWon = false;

    const roster = rosterByTeam.get(row.teamId);
    if (!roster || !roster.length) return;

    const optimal = calculateOptimalLineupScore_(roster);

    if (optimal > 0) {
      row.efficiency = Math.min(100, (row.score / optimal) * 100);
      row.optimal = Math.round(optimal * 100) / 100;
      row.benchGap = Math.max(0, Math.round((optimal - row.score) * 100) / 100);
      row.couldHaveWon = row.result === 'L' && optimal > row.opponentScore;
    }

    const projection = rosterProjectionTotal_(normalizeBattleLineup_(roster).starters.filter(Boolean));
    if (projection > 0) row.projectionRatio = row.score / projection;
  });

  const byRank = rows.slice().sort((a, b) => a.rank - b.rank);
  const decided = pairs.filter(pair => !pair.tie);

  const starters = pooledStartersForWeek_(snapshots, week)
    .sort((a, b) => b.points - a.points || String(a.name).localeCompare(String(b.name)));

  const topPlayer = starters[0];
  const playerOfWeek = topPlayer && topPlayer.points > 0
    ? {
        name: topPlayer.name, position: topPlayer.position, nflTeam: topPlayer.nflTeam || '',
        points: topPlayer.points, teamId: topPlayer.fantasyTeamId
      }
    : null;

  const nailBiter = decided.length
    ? decided.slice().sort((a, b) => a.margin - b.margin || a.matchupId - b.matchupId)[0]
    : null;

  const blowout = decided.length
    ? decided.slice().sort((a, b) => b.margin - a.margin || a.matchupId - b.matchupId)[0]
    : null;

  const shootout = pairs.length
    ? pairs.slice().sort((a, b) => b.combined - a.combined || a.matchupId - b.matchupId)[0]
    : null;

  // Best score among the losers. It only counts as "unlucky" when that score
  // sat in the top half of the league; otherwise it was simply a bad week.
  const bestLoser = rows
    .filter(row => row.result === 'L')
    .sort((a, b) => b.score - a.score || a.margin - b.margin)[0] || null;

  const unluckiest = bestLoser && bestLoser.rank <= Math.ceil(rows.length / 2)
    ? { ...bestLoser, perfect: bestLoser.efficiency != null && bestLoser.efficiency >= 99.9 }
    : null;

  // Who left the most points on their own bench? A loser whose bench would have
  // WON them the game always ranks first; below 5 points it is not worth a story.
  const benchLeader = rows
    .filter(row => row.benchGap >= 5)
    .sort((a, b) =>
      Number(b.couldHaveWon) - Number(a.couldHaveWon) ||
      b.benchGap - a.benchGap ||
      a.teamId - b.teamId
    )[0] || null;

  const results = pairs
    .slice()
    .sort((a, b) => b.winnerScore - a.winnerScore || a.matchupId - b.matchupId);

  const average = rows.length
    ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length
    : 0;

  return {
    week,
    complete,
    hasRosters: snapshots.length > 0,
    builtAt: Date.now(),
    teamCount: rows.length,
    teamOfWeek: byRank[0] || null,
    playerOfWeek,
    nailBiter,
    blowout,
    shootout,
    unluckiest,
    benchLeader,
    average,
    high: byRank[0] ? byRank[0].score : 0,
    low: byRank.length ? byRank[byRank.length - 1].score : 0,
    results,
    rows
  };
}

/* ---------- cache ---------- */

function loadRecapCache_(week) {
  try {
    const raw = localStorage.getItem(RECAP_CACHE_PREFIX + Number(week));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed.savedAt || 0);
    const current = Number(state.league && state.league.currentWeek || 0);

    // The latest finished week gets a short life so late ESPN stat
    // corrections still reach the page.
    const maxAge = Number(week) >= current - 1 ? RECAP_LATEST_TTL_MS : RECAP_OLD_TTL_MS;

    if (!savedAt || !parsed.recap || (Date.now() - savedAt) > maxAge) return null;
    return parsed.recap;
  } catch (error) {
    return null;
  }
}

function saveRecapCache_(recap) {
  try {
    localStorage.setItem(
      RECAP_CACHE_PREFIX + Number(recap.week),
      JSON.stringify({ savedAt: Date.now(), recap })
    );
  } catch (error) {
    console.warn('Unable to save recap cache:', error);
  }
}

/* ---------- show / hide ---------- */

function syncRecapState_() {
  const section = document.getElementById('weekRecap');
  if (!section) return;

  const hero = document.getElementById('overviewHero');
  const openButton = document.getElementById('recapOpen');
  const weekLabel = document.getElementById('thisWeekLabel');
  const context = getRecapContext_();

  const hasWeek = Boolean(context && context.week && context.week >= 1);
  const auto = Boolean(hasWeek && context.mode === 'recap' && state.matchupsResolved);
  const show = hasWeek && (auto || state.recapForced);

  if (openButton) {
    openButton.hidden = !(hasWeek && !show && state.matchupsResolved);
    const label = openButton.querySelector('span');
    if (label && hasWeek) label.textContent = `Week ${context.week} recap`;
  }

  if (!show) {
    stopRecapCountdown_();
    section.hidden = true;
    if (hero) hero.hidden = false;
    if (weekLabel) weekLabel.hidden = true;
    return;
  }

  section.hidden = false;
  if (hero) hero.hidden = true;

  // Two clearly labelled halves: last week's recap, then this week's board.
  if (weekLabel) {
    weekLabel.hidden = !(context.current > context.week);
    const text = weekLabel.querySelector('span');
    if (text) text.textContent = `This week · Week ${context.current}`;
  }

  const rendered = state.recap && Number(state.recap.week) === Number(context.week) && section.childElementCount > 0 &&
    section.dataset.forced === (state.recapForced ? '1' : '0');

  if (rendered) {
    updateRecapCountdown_();
    return;
  }

  loadWeekRecap_(context.week);
}

/**
 * Recap data only (no DOM). Shared by the recap panel and the My Team strip.
 */
async function getRecapData_(week, force = false) {
  if (!force) {
    const cached = loadRecapCache_(week);
    if (cached) return cached;
  }

  const [matchups, snapshots] = await Promise.all([
    getWeekMatchups(week),
    getWeekRosterSnapshots_(week).catch(error => {
      console.warn('Recap: weekly rosters unavailable, building a lighter recap.', error);
      return null;
    })
  ]);

  if (!Array.isArray(matchups) || !matchups.length) {
    throw new Error(`No Week ${week} matchup data is available yet.`);
  }

  const recap = buildWeekRecap_({ week, matchups, snapshots: snapshots || [] });

  // Only cache a complete picture, so a failed roster request is retried next time.
  if (recap.complete && recap.hasRosters) saveRecapCache_(recap);

  return recap;
}

async function loadWeekRecap_(week, force = false) {
  const section = document.getElementById('weekRecap');
  if (!section) return;

  const token = ++state.recapToken;

  if (!force) {
    const cached = loadRecapCache_(week);

    if (cached) {
      state.recap = cached;
      renderWeekRecap_();
      loadRecapKickoff_();
      return;
    }
  }

  section.innerHTML = `
    <div class="recap-loading" aria-hidden="true">
      <div class="recap-skel recap-skel-hero"></div>
      <div class="recap-skel-row"><i></i><i></i><i></i><i></i><i></i></div>
    </div>`;

  try {
    const recap = await getRecapData_(week, true);
    if (token !== state.recapToken) return;

    state.recap = recap;
    renderWeekRecap_();
    loadRecapKickoff_();

  } catch (error) {
    if (token !== state.recapToken) return;

    section.innerHTML = `
      <div class="error-panel recap-error">
        The Week ${escapeHtml(String(week))} recap could not be built. ${escapeHtml(error && error.message ? error.message : String(error))}
        <button type="button" class="performer-tab" data-recap-retry>Retry</button>
      </div>`;

    const retry = section.querySelector('[data-recap-retry]');
    if (retry) retry.addEventListener('click', () => loadWeekRecap_(week, true));
  }
}

/* ---------- kickoff countdown ---------- */

const KICKOFF_CACHE_KEY = 'ZENNI_FANTASY_KICKOFF_V1';

function saveKickoffCache_(ms) {
  try {
    localStorage.setItem(KICKOFF_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), ms }));
  } catch (error) { /* ignore */ }
}

function loadKickoffCache_() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KICKOFF_CACHE_KEY) || 'null');
    return parsed && Number.isFinite(Number(parsed.ms)) ? Number(parsed.ms) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Cached matchup statuses can be hours old. "Everything is scheduled" is the
 * one state that silently stops being true (the moment a game kicks off), so
 * it is only trusted while the next known kickoff is still in the future.
 * FINAL and LIVE never move backwards, so they are always trusted.
 */
function cachedMatchupsTrusted_(cached) {
  if (!cached || !Array.isArray(cached.matchups) || !cached.matchups.length) return false;
  if (Number(cached.ageMs) < 10 * 60 * 1000) return true;

  const allScheduled = cached.matchups.every(match => String(match && match.status || '').toUpperCase() === 'SCHEDULED');
  if (!allScheduled) return true;

  const kickoff = loadKickoffCache_();
  return Boolean(kickoff && kickoff > Date.now());
}

async function loadRecapKickoff_() {
  if (Date.now() - state.kickoffFetchedAt < RECAP_KICKOFF_REFRESH_MS) {
    updateRecapCountdown_();
    return;
  }

  // Throttle even on failure (an older API deployment has no schedule mode).
  state.kickoffFetchedAt = Date.now();

  try {
    const data = await api_('schedule');
    state.kickoffMs = data && Number.isFinite(Number(data.nextKickoffMs)) ? Number(data.nextKickoffMs) : null;
    if (state.kickoffMs) saveKickoffCache_(state.kickoffMs);
  } catch (error) {
    state.kickoffMs = null;
  }

  updateRecapCountdown_();
}

function stopRecapCountdown_() {
  if (state.recapCountdownTimer) {
    window.clearInterval(state.recapCountdownTimer);
    state.recapCountdownTimer = null;
  }
}

function updateRecapCountdown_() {
  const box = document.querySelector('[data-recap-countdown]');
  if (!box) {
    stopRecapCountdown_();
    return;
  }

  const diff = state.kickoffMs ? state.kickoffMs - Date.now() : 0;

  if (!(diff > 0)) {
    box.hidden = true;
    stopRecapCountdown_();
    return;
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);

  const set = (key, value) => {
    const element = box.querySelector(`[data-cd="${key}"]`);
    if (element) element.textContent = String(value).padStart(2, '0');
  };

  set('d', days);
  set('h', hours);
  set('m', minutes);
  box.hidden = false;

  if (!state.recapCountdownTimer) {
    state.recapCountdownTimer = window.setInterval(updateRecapCountdown_, 30000);
  }
}

/* ---------- motion ---------- */

function recapPrefersReducedMotion_() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function animateRecapNumber_(element, target, duration = 900) {
  if (!element) return;

  element.textContent = number2(target);
  if (recapPrefersReducedMotion_() || document.hidden) return;

  const start = performance.now();

  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    element.textContent = number2(target * eased);

    if (t < 1) {
      window.requestAnimationFrame(step);
    } else {
      element.textContent = number2(target);
    }
  };

  window.requestAnimationFrame(step);
}

/* ---------- render ---------- */

function recapLogo_(team, className = 'recap-logo') {
  return `<img class="${className} ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="" ${teamIconFallbackAttr(team)}>`;
}

function renderWeekRecap_() {
  const section = document.getElementById('weekRecap');
  const recap = state.recap;
  if (!section || !recap || !recap.teamOfWeek) return;

  const week = Number(recap.week);
  const top = recap.teamOfWeek;
  const topTeam = state.teamMap.get(Number(top.teamId));
  const topOpponent = state.teamMap.get(Number(top.opponentId));
  const animate = state.recapAnimatedWeek !== week && !recapPrefersReducedMotion_();
  const nextWeek = Math.max(Number(state.league && state.league.currentWeek || 0), week + 1);

  const closest = recap.nailBiter;
  const biggest = recap.blowout;

  const intro = [
    `${recap.results.length} games in the books.`,
    biggest ? `The biggest margin was ${number2(biggest.margin)} points` : '',
    closest ? `and the closest was ${number2(closest.margin)}.` : '',
    recap.complete ? `Final until Week ${nextWeek} kicks off.` : 'Some scores are still being confirmed.'
  ].filter(Boolean).join(' ').replace(/ and the closest/, ', and the closest');

  const pills = [`<span class="recap-pill is-good">#1 of ${recap.teamCount} scorers</span>`];
  if (top.efficiency != null) pills.push(`<span class="recap-pill">${Math.round(top.efficiency)}% lineup efficiency</span>`);
  if (top.projectionRatio != null) {
    const delta = Math.round((top.projectionRatio - 1) * 100);
    pills.push(`<span class="recap-pill">${delta >= 0 ? '+' : ''}${delta}% vs projection</span>`);
  }

  /* ---- story cards ---- */
  const stories = [];

  if (recap.playerOfWeek) {
    const player = recap.playerOfWeek;
    stories.push({
      icon: '🌟', label: 'Player of the Week', title: escapeHtml(player.name),
      body: `<b class="recap-big">${number2(player.points)} pts</b>${escapeHtml(player.position === 'DST' ? 'D/ST' : player.position)}${player.nflTeam ? ` · ${escapeHtml(player.nflTeam)}` : ''} · started for ${escapeHtml(recapTeamName_(player.teamId))}`
    });
  }

  if (closest) {
    stories.push({
      icon: '⚡', label: 'Nail-biter',
      title: `${escapeHtml(recapTeamName_(closest.winnerId))} edge ${escapeHtml(recapTeamName_(closest.loserId))} by ${number2(closest.margin)}`,
      body: `${number2(closest.winnerScore)} to ${number2(closest.loserScore)}, the closest game of the week.`
    });
  }

  if (recap.unluckiest) {
    const unlucky = recap.unluckiest;
    const lineup = unlucky.perfect
      ? 'with a <b>perfect lineup</b>'
      : unlucky.efficiency != null ? `with a <b>${Math.round(unlucky.efficiency)}% efficient</b> lineup` : '';

    stories.push({
      icon: '💔', label: 'Unluckiest loss', tone: 'bad', title: escapeHtml(recapTeamName_(unlucky.teamId)),
      body: `${number2(unlucky.score)} was the <b>${recapOrdinal_(unlucky.rank)}-best score</b> of the week${lineup ? `, ${lineup}` : ''}. Still lost by ${number2(unlucky.margin)}.`
    });
  } else if (biggest) {
    stories.push({
      icon: '🔥', label: 'Biggest blowout', title: `${escapeHtml(recapTeamName_(biggest.winnerId))} by ${number2(biggest.margin)}`,
      body: `${number2(biggest.winnerScore)} to ${number2(biggest.loserScore)} over ${escapeHtml(recapTeamName_(biggest.loserId))}.`
    });
  }

  // Bench story beats the Shootout: Jeremy's vs Boom is already told by
  // Team of the Week, the Unluckiest Loss and the results list.
  if (recap.benchLeader) {
    const bench = recap.benchLeader;

    stories.push({
      icon: '💺', label: 'Left on the bench', tone: bench.couldHaveWon ? 'bad' : '',
      title: `${number2(bench.benchGap)} points`,
      body: `<b>${escapeHtml(recapTeamName_(bench.teamId))}</b> scored ${number2(bench.score)}, but its best lineup was worth ${number2(bench.optimal)}${bench.couldHaveWon ? `, enough to beat ${escapeHtml(recapTeamName_(bench.opponentId))} (${number2(bench.opponentScore)})` : ''}.`
    });
  } else if (recap.shootout) {
    const shoot = recap.shootout;

    stories.push({
      icon: '💥', label: 'Shootout', title: `${number2(shoot.combined)} combined`,
      body: `${escapeHtml(recapTeamName_(shoot.homeTeamId))} ${number2(shoot.homeScore)} vs ${escapeHtml(recapTeamName_(shoot.awayTeamId))} ${number2(shoot.awayScore)}, the most points in one game.`
    });
  }

  // The unbeaten/winless race lives in Race Snapshot, right below. Not repeated here.
  stories.push({
    icon: '📊', label: 'Week in numbers', title: `${number2(recap.average)} average`,
    body: `Top score ${number2(top.score)}, lowest ${number2(recap.low != null ? recap.low : 0)}. ${recap.teamCount} teams, ${recap.results.length} games.`
  });

  const myStory = recapMyStory_(recap);
  if (myStory) stories.unshift(myStory);
  const storyCount = Math.min(stories.length, myStory ? 6 : 5);

  const storyHtml = stories.slice(0, storyCount).map((story, index) => `
    <article class="recap-card recap-story ${story.tone === 'bad' ? 'is-bad' : ''} ${story.tone === 'win' ? 'is-win' : ''} ${story.mine ? 'is-mine-story' : ''}" style="--i:${index + 3}" data-story-index="${index}">
      <span class="recap-story-icon">${story.icon}</span>
      <span class="recap-story-label">${story.label}</span>
      <h3>${story.title}</h3>
      <p>${story.body}</p>
    </article>`).join('');

  /* ---- all results ---- */
  const resultsHtml = recap.results.map(pair => {
    const winner = state.teamMap.get(Number(pair.winnerId));
    const loser = state.teamMap.get(Number(pair.loserId));
    return `
      <div class="recap-result ${pair.tie ? 'is-tie' : ''}" data-team-ids="${pair.winnerId},${pair.loserId}">
        <div class="recap-result-team">${recapLogo_(winner)}<span>${escapeHtml(winner ? winner.name : 'Team')}</span></div>
        <strong class="recap-score ${pair.tie ? '' : 'is-win'}">${number2(pair.winnerScore)}</strong>
        <em>${pair.tie ? 'TIE' : 'VS'}</em>
        <strong class="recap-score is-lose">${number2(pair.loserScore)}</strong>
        <div class="recap-result-team is-right"><span>${escapeHtml(loser ? loser.name : 'Team')}</span>${recapLogo_(loser)}</div>
      </div>`;
  }).join('');

  const closeButton = state.recapForced
    ? '<button type="button" class="recap-close" data-recap-close>← Back to overview</button>'
    : '';

  section.className = `week-recap ${animate ? 'is-entering' : ''}`;
  section.dataset.forced = state.recapForced ? '1' : '0';
  section.innerHTML = `
    <div class="recap-hero">
      <article class="recap-card recap-intro" style="--i:0">
        ${closeButton}
        <span class="recap-lock ${recap.complete ? '' : 'is-pending'}">${recap.complete ? '✓' : '●'} WEEK ${week} · ${recap.complete ? 'FINAL · LOCKED' : 'PROVISIONAL'}</span>
        <h2>THE WEEK<br><span>THAT WAS</span></h2>
        <p>${escapeHtml(intro)}</p>
        <div class="recap-intro-footer">
        <div class="recap-countdown" data-recap-countdown hidden>
          <span class="section-kicker">Week ${nextWeek} kicks off in</span>
          <div class="recap-cd">
            <div><b data-cd="d">00</b><small>Days</small></div>
            <div><b data-cd="h">00</b><small>Hrs</small></div>
            <div><b data-cd="m">00</b><small>Min</small></div>
          </div>
        </div>
        ${recapShareActionsHtml_()}
        </div>
      </article>

      <article class="recap-card recap-totw" style="--i:1">
        <div>
          <span class="section-kicker">🏆 Team of the Week</span>
          <h3>${escapeHtml(topTeam ? topTeam.name : 'Team')}</h3>
          <p>${escapeHtml(topTeam ? ownerText(topTeam) : '')}${topOpponent ? ` · ${top.result === 'L' ? 'lost to' : top.result === 'T' ? 'tied' : 'beat'} ${escapeHtml(topOpponent.name)}${top.result === 'T' ? '' : ` by ${number2(top.margin)}`}` : ''}</p>
        </div>
        <div class="recap-totw-score" data-recap-score>${number2(top.score)}</div>
        <div class="recap-pills">${pills.join('')}</div>
      </article>
    </div>

    <div class="recap-progress" aria-hidden="true">${Array.from({ length: storyCount }, (_, index) => `<i class="${index === 0 ? 'is-on' : ''}"></i>`).join('')}</div>
    <div class="recap-stories" data-recap-stories>${storyHtml}</div>
    <p class="recap-swipe-hint">Tap a story or swipe for the next one</p>

    <article class="recap-card recap-results" style="--i:8">
      <div class="recap-results-head"><span class="section-kicker">All results</span><span>Week ${week} · ${recap.complete ? 'Final' : 'Provisional'}</span></div>
      <div class="recap-results-grid">${resultsHtml}</div>
    </article>`;

  const close = section.querySelector('[data-recap-close]');
  if (close) {
    close.addEventListener('click', () => {
      state.recapForced = false;
      syncRecapState_();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  const battle = section.querySelector('[data-recap-battle]');
  if (battle) battle.addEventListener('click', () => switchView('battle'));

  if (animate) {
    state.recapAnimatedWeek = week;
    animateRecapNumber_(section.querySelector('[data-recap-score]'), top.score);
  }

  section.querySelectorAll('[data-share-kind]').forEach(button => {
    button.addEventListener('click', () => openShareDialog_(button.dataset.shareKind));
  });

  const linkButton = section.querySelector('[data-share-link]');
  if (linkButton) linkButton.addEventListener('click', () => copyPageLink_(linkButton));

  bindRecapStories_(section);
  applyMyTeamHighlights_();
  updateRecapCountdown_();
}

/* =========================================================
   LIVE MOTION
   Rules: nothing animates on page load, nothing animates after a long
   absence, and every effect says something happened:
     score changed  -> number rolls up + "+x.xx" chip
     lead flipped   -> card pulses + LEAD CHANGE pill
     game finished  -> winner gold sweep, loser dims (and stays that way)
     player scored  -> one toast at a time
     win chance     -> bar eases to the new value
   ========================================================= */

const SCORE_MEMORY_MAX_AGE_MS = 10 * 60 * 1000;
const MOTION_QUIET_AFTER_WARM_MS = 12000;
const TOAST_VISIBLE_MS = 2600;
const TOAST_MAX_INDIVIDUAL = 3;

const MOTION_SURFACES = Object.freeze([
  { host: '.overview-matchup-card[data-matchup-key]', home: '.overview-matchup-home', away: '.overview-matchup-away', score: '.matchup-score' },
  { host: '.battle-card[data-matchup-key]', home: '.battle-mini-left', away: '.battle-mini-right', score: 'span' },
  { host: '.motw-stage[data-matchup-key]', home: '.battle-fighter-left', away: '.battle-fighter-right', score: '.fighter-score' },
  { host: '#featuredMatchup[data-matchup-key]', home: '.featured-team-left', away: '.featured-team-right', score: '.featured-score' },
  { host: '.mystrip-card[data-matchup-key]', home: '.mystrip-team[data-side="home"]', away: '.mystrip-team[data-side="away"]', score: '.mystrip-score' }
]);

function motionReduced_() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function setScoreText_(element, value) {
  const text = number2(value);

  if (element.firstChild && element.firstChild.nodeType === 3) {
    element.firstChild.nodeValue = text;
  } else {
    element.insertBefore(document.createTextNode(text), element.firstChild);
  }
}

function rollNumber_(element, from, to, duration = 650) {
  if (!element) return;

  if (motionReduced_() || document.hidden) {
    setScoreText_(element, to);
    return;
  }

  const start = performance.now();
  setScoreText_(element, from);

  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    setScoreText_(element, from + (to - from) * eased);

    if (t < 1) {
      window.requestAnimationFrame(step);
    } else {
      setScoreText_(element, to);
    }
  };

  window.requestAnimationFrame(step);
}

function timedClass_(element, className, ms) {
  if (!element) return;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), ms);
}

function scoreGain_(element, from, to) {
  if (!element) return;

  rollNumber_(element, from, to);
  timedClass_(element, 'score-bump', 1500);

  const chip = document.createElement('span');
  chip.className = 'score-chip';
  chip.textContent = `+${number2(to - from)}`;
  element.appendChild(chip);
  window.setTimeout(() => chip.remove(), 2400);
}

function collectMotionHosts_() {
  const byKey = new Map();

  MOTION_SURFACES.forEach(surface => {
    document.querySelectorAll(surface.host).forEach(host => {
      const key = host.dataset.matchupKey;
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ surface, host });
    });
  });

  return byKey;
}

function applyMatchupMotion_(matchups, week) {
  const list = Array.isArray(matchups) ? matchups : [];
  if (!list.length) return;

  const isCurrentWeek = Number(week) === Number(state.league && state.league.currentWeek);
  const animateLive = isCurrentWeek && state.matchupsResolved;
  const hostsByKey = collectMotionHosts_();
  const now = Date.now();
  const quiet = now < Number(state.motionQuietUntil || 0);

  list.forEach(match => {
    const key = battleMatchupKey_(match, week);
    const targets = hostsByKey.get(key) || [];

    const homeScore = Number(match.homeScore || 0);
    const awayScore = Number(match.awayScore || 0);
    const status = String(match.status || '').toUpperCase();
    const isFinal = status === 'FINAL';
    const decided = isFinal && homeScore !== awayScore;

    // Finished games look finished everywhere, for every week.
    targets.forEach(({ surface, host }) => {
      const homeSide = host.querySelector(surface.home);
      const awaySide = host.querySelector(surface.away);

      [[homeSide, homeScore > awayScore], [awaySide, awayScore > homeScore]].forEach(([side, wins]) => {
        if (!side) return;
        side.classList.toggle('motion-win', decided && wins);
        side.classList.toggle('motion-lose', decided && !wins);
      });
    });

    if (!animateLive) return;

    const previous = state.scoreMemory.get(key);
    state.scoreMemory.set(key, { home: homeScore, away: awayScore, status, at: now });

    // First sighting, a quiet window, or a stale baseline: remember, never animate.
    if (!previous || quiet || (now - previous.at) > SCORE_MEMORY_MAX_AGE_MS) return;

    const homeGain = homeScore - previous.home;
    const awayGain = awayScore - previous.away;

    const leaderBefore = Math.sign(previous.home - previous.away);
    const leaderAfter = Math.sign(homeScore - awayScore);
    const leadChanged = leaderBefore !== 0 && leaderAfter !== 0 && leaderBefore !== leaderAfter;
    const justFinished = previous.status !== 'FINAL' && isFinal;

    targets.forEach(({ surface, host }) => {
      const homeEl = host.querySelector(`${surface.home} ${surface.score}`);
      const awayEl = host.querySelector(`${surface.away} ${surface.score}`);

      if (homeGain > 0.004) scoreGain_(homeEl, previous.home, homeScore);
      if (awayGain > 0.004) scoreGain_(awayEl, previous.away, awayScore);

      if (leadChanged && !isFinal) {
        timedClass_(host, 'is-lead-change', 1900);

        if (!host.querySelector('.lead-pill')) {
          const pill = document.createElement('span');
          pill.className = 'lead-pill';
          pill.textContent = '⚡ Lead change';
          host.appendChild(pill);
          window.setTimeout(() => pill.remove(), 4000);
        }
      }

      if (justFinished && decided) timedClass_(host, 'just-finalized', 2600);
    });
  });
}

/* ---------- FantasyCast: win chance + team score ---------- */

function applyCastMotion_(container, match, week, snapshot) {
  const key = battleMatchupKey_(match, week);
  const now = Date.now();
  const previous = state.castMemory.get(key);

  state.castMemory.set(key, {
    home: snapshot.homeScore, away: snapshot.awayScore, chanceHome: snapshot.chance.home, at: now
  });

  if (!previous || (now - previous.at) > SCORE_MEMORY_MAX_AGE_MS) return;

  const homeEl = container.querySelector('.fantasycast-team-left .fantasycast-score');
  const awayEl = container.querySelector('.fantasycast-team-right .fantasycast-score');

  if (snapshot.homeScore - previous.home > 0.004) scoreGain_(homeEl, previous.home, snapshot.homeScore);
  if (snapshot.awayScore - previous.away > 0.004) scoreGain_(awayEl, previous.away, snapshot.awayScore);

  const shift = snapshot.chance.home - previous.chanceHome;
  const bar = container.querySelector('.fantasycast-winbar > span');

  if (bar && shift !== 0 && !motionReduced_()) {
    // The panel is rebuilt on every refresh. Start the bar where it WAS and
    // let the CSS transition carry it to where it IS.
    bar.style.transition = 'none';
    bar.style.width = `${previous.chanceHome}%`;
    void bar.offsetWidth;
    bar.style.transition = '';
    window.requestAnimationFrame(() => { bar.style.width = `${snapshot.chance.home}%`; });
  }

  if (Math.abs(shift) >= 2) {
    const homeName = snapshot.home ? snapshot.home.name : 'Home';
    const note = document.createElement('div');
    note.className = 'winbar-shift';
    note.textContent = `⚡ Win chance moved: ${homeName} ${previous.chanceHome}% → ${snapshot.chance.home}%`;

    const barWrap = container.querySelector('.fantasycast-winbar');
    if (barWrap && barWrap.parentNode) barWrap.parentNode.insertBefore(note, barWrap.nextSibling);
    window.setTimeout(() => note.remove(), 4400);
  }
}

/* ---------- FantasyCast: scoring toasts (one at a time) ---------- */

function detectCastPlays_(week, match, homeRoster, awayRoster) {
  const now = Date.now();
  const events = [];

  [[match.homeTeamId, homeRoster], [match.awayTeamId, awayRoster]].forEach(([teamId, roster]) => {
    normalizeBattleLineup_(roster).starters.filter(Boolean).forEach(player => {
      const points = battlePlayerActualPoints_(player);
      if (points == null || !player.playerId) return;

      const key = `${Number(week)}:${Number(teamId)}:${player.playerId}`;
      const previous = state.castPlayerMemory.get(key);
      state.castPlayerMemory.set(key, { points, at: now });

      if (!previous || (now - previous.at) > SCORE_MEMORY_MAX_AGE_MS) return;

      const gain = points - previous.points;
      if (gain >= 0.1) events.push({ name: player.name || 'A starter', gain, teamId: Number(teamId) });
    });
  });

  if (!events.length) return;

  // A pile of updates after a gap becomes ONE summary, not a slot machine.
  if (events.length > TOAST_MAX_INDIVIDUAL) {
    const total = events.reduce((sum, event) => sum + event.gain, 0);
    enqueueLiveToast_({ title: `${events.length} scoring updates`, detail: `+${number2(total)} pts across both lineups` });
    return;
  }

  events.sort((a, b) => b.gain - a.gain).forEach(event => {
    const team = state.teamMap.get(event.teamId);
    enqueueLiveToast_({
      title: event.name,
      detail: `+${number2(event.gain)} pts · ${team ? team.name : 'Team'}`
    });
  });
}

function ensureToastHost_() {
  let host = document.getElementById('liveToasts');

  if (!host) {
    host = document.createElement('div');
    host.id = 'liveToasts';
    host.className = 'live-toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }

  return host;
}

function enqueueLiveToast_(toast) {
  if (state.toastQueue.length >= 6) return;
  state.toastQueue.push(toast);
  pumpLiveToasts_();
}

function pumpLiveToasts_() {
  if (state.toastShowing || !state.toastQueue.length) return;

  const toast = state.toastQueue.shift();
  const host = ensureToastHost_();

  state.toastShowing = true;

  const element = document.createElement('div');
  element.className = 'live-toast';
  element.innerHTML = `
    <span class="live-toast-icon">🏈</span>
    <div><strong>${escapeHtml(toast.title)}</strong><small>${escapeHtml(toast.detail)}</small></div>`;
  host.appendChild(element);

  window.setTimeout(() => {
    element.classList.add('is-leaving');

    window.setTimeout(() => {
      element.remove();
      state.toastShowing = false;
      pumpLiveToasts_();
    }, motionReduced_() ? 0 : 280);
  }, TOAST_VISIBLE_MS);
}

/* ---------- freshness: "updated 3m ago" + slow-ESPN banner ---------- */

function formatAgo_(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
  if (seconds < 90) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function renderApiFreshness_() {
  const ageElement = document.getElementById('apiAge');
  const banner = document.getElementById('staleBanner');
  const age = state.lastSyncAt ? Date.now() - state.lastSyncAt : null;

  if (ageElement) {
    if (age != null && age >= 90000) {
      ageElement.textContent = `updated ${formatAgo_(age)}`;
      ageElement.hidden = false;
    } else {
      ageElement.hidden = true;
    }
  }

  if (!banner) return;

  // leagueDegraded is only set AFTER a refresh has failed, so a normal slow
  // load never flashes this. Delayed scores wait 2 minutes before speaking up.
  const show = state.leagueDegraded || (state.scoresStale && age != null && age >= 120000);

  if (!show) {
    banner.hidden = true;
    return;
  }

  const text = banner.querySelector('[data-stale-text]');
  const when = age != null ? formatAgo_(age) : 'earlier';

  if (text) {
    text.textContent = state.leagueDegraded
      ? `ESPN is slow to respond. Showing saved scores from ${when}. Retrying…`
      : `Live scores are delayed. Last update ${when}. Retrying…`;
  }

  banner.hidden = false;
}

/* =========================================================
   MY TEAM
   Follow one team. Saved on this device only (no login). The page then
   opens on your matchup, marks your team everywhere, and tells you how
   your week went.
   ========================================================= */

const MY_TEAM_KEY = 'ZENNI_FANTASY_MY_TEAM_V1';
const MY_TEAM_PROMPT_KEY = 'ZENNI_FANTASY_MY_TEAM_PROMPT_V1';
const MY_TEAM_PROMPT_SNOOZE_MS = 45 * 24 * 60 * 60 * 1000;

function getMyTeamId_() {
  try {
    const id = Number(localStorage.getItem(MY_TEAM_KEY));
    if (id && state.teamMap && state.teamMap.has(id)) return id;
  } catch (error) { /* ignore */ }

  return null;
}

function setMyTeamId_(teamId) {
  try {
    if (teamId) {
      localStorage.setItem(MY_TEAM_KEY, String(Number(teamId)));
    } else {
      localStorage.removeItem(MY_TEAM_KEY);
    }
  } catch (error) {
    console.warn('Unable to save My Team:', error);
  }

  refreshMyTeamUi_();
}

function myTeamPromptSnoozed_() {
  try {
    const at = Number(localStorage.getItem(MY_TEAM_PROMPT_KEY) || 0);
    return Boolean(at && (Date.now() - at) < MY_TEAM_PROMPT_SNOOZE_MS);
  } catch (error) {
    return false;
  }
}

function snoozeMyTeamPrompt_() {
  try { localStorage.setItem(MY_TEAM_PROMPT_KEY, String(Date.now())); } catch (error) { /* ignore */ }
  renderMyTeamStrip_();
}

function refreshMyTeamUi_() {
  renderMyTeamStrip_();
  applyMyTeamHighlights_();

  const section = document.getElementById('weekRecap');
  if (section && !section.hidden && state.recap) renderWeekRecap_();
}

function keyTeamIds_(key) {
  const part = String(key || '').split(':')[1] || '';
  return part.split('-').map(Number).filter(Boolean);
}

function myMatchupKeyIn_(matchups, week) {
  const myId = getMyTeamId_();
  if (!myId) return null;

  const match = (matchups || []).find(item =>
    Number(item.homeTeamId) === myId || Number(item.awayTeamId) === myId
  );

  return match ? battleMatchupKey_(match, week) : null;
}

/** This team's result for the most recent finished week, or null. */
function getMyWeekSummary_() {
  const myId = getMyTeamId_();
  if (!myId) return null;

  const context = getRecapContext_();
  const recap = state.recap && Array.isArray(state.recap.rows) ? state.recap : state.myWeekRecap;

  if (!recap || !Array.isArray(recap.rows)) return null;
  if (context && context.week && Number(recap.week) !== Number(context.week) && !state.recapForced) return null;

  const row = recap.rows.find(item => Number(item.teamId) === myId);
  return row ? { ...row, week: recap.week, teamCount: recap.teamCount } : null;
}

async function ensureMyWeekData_() {
  const context = getRecapContext_();
  if (!context || !context.week || !getMyTeamId_()) return;
  if (state.recap && Number(state.recap.week) === Number(context.week)) return;
  if (state.myWeekRecap && Number(state.myWeekRecap.week) === Number(context.week)) return;
  if (state.myWeekLoading === context.week) return;

  state.myWeekLoading = context.week;

  try {
    state.myWeekRecap = await getRecapData_(context.week);
  } catch (error) {
    console.warn('My Team: last week data unavailable.', error);
  } finally {
    state.myWeekLoading = null;
  }

  renderMyTeamStrip_();
}

function myResultText_(summary) {
  const verdict = summary.result === 'W' ? 'WIN' : summary.result === 'L' ? 'LOSS' : 'TIE';
  if (summary.result === 'T') return verdict;
  return `${verdict} ${summary.result === 'W' ? '+' : '−'}${number2(summary.margin)}`;
}

function renderMyTeamStrip_() {
  const wrap = document.getElementById('myTeamStrip');
  if (!wrap || !state.league) return;

  const myId = getMyTeamId_();
  const current = Number(state.league.currentWeek || 1);

  // Not following yet: one polite question, easy to dismiss, never repeated.
  if (!myId) {
    if (myTeamPromptSnoozed_() || !state.teams.length) {
      wrap.hidden = true;
      wrap.innerHTML = '';
      return;
    }

    wrap.hidden = false;
    wrap.className = 'my-strip is-prompt';
    wrap.innerHTML = `
      <span class="my-strip-ask">★ <b>Which team is yours?</b> Pick once and this page opens on your matchup.</span>
      <div class="my-strip-actions">
        <button type="button" class="my-strip-primary" data-mine-pick>Pick my team</button>
        <button type="button" class="my-strip-ghost" data-mine-snooze>Not now</button>
      </div>`;

    wrap.querySelector('[data-mine-pick]').addEventListener('click', openTeamPicker_);
    wrap.querySelector('[data-mine-snooze]').addEventListener('click', snoozeMyTeamPrompt_);
    return;
  }

  const team = state.teamMap.get(myId);
  const matches = Array.isArray(state.currentMatchups) ? state.currentMatchups : [];
  const match = matches.find(item => Number(item.homeTeamId) === myId || Number(item.awayTeamId) === myId);

  wrap.hidden = false;
  wrap.className = 'my-strip';

  if (!match) {
    wrap.innerHTML = `
      <div class="mystrip-card">
        <span class="mystrip-star">★</span>
        <div class="mystrip-team is-me">${recapLogo_(team, 'mystrip-logo')}<div class="mystrip-name"><strong>${escapeHtml(team ? team.name : 'My team')}</strong><span>No Week ${current} matchup found</span></div></div>
        <div class="mystrip-meta"><button type="button" class="my-strip-ghost" data-mine-pick>Change</button></div>
      </div>`;
    wrap.querySelector('[data-mine-pick]').addEventListener('click', openTeamPicker_);
    return;
  }

  const iAmHome = Number(match.homeTeamId) === myId;
  const opponent = state.teamMap.get(Number(iAmHome ? match.awayTeamId : match.homeTeamId));
  const myScore = Number(iAmHome ? match.homeScore : match.awayScore || 0);
  const theirScore = Number(iAmHome ? match.awayScore : match.homeScore || 0);
  const status = String(match.status || 'SCHEDULED').toUpperCase();
  const summary = getMyWeekSummary_();

  const statusHtml = status === 'LIVE'
    ? '<span class="mystrip-status is-live">● LIVE</span>'
    : status === 'FINAL'
      ? '<span class="mystrip-status">FINAL</span>'
      : '<span class="mystrip-status">Not started</span>';

  const lastWeekHtml = summary
    ? `<span class="mystrip-last ${summary.result === 'W' ? 'is-win' : summary.result === 'L' ? 'is-loss' : ''}">Your Week ${summary.week}: ${escapeHtml(myResultText_(summary))} · #${summary.rank} of ${summary.teamCount}</span>`
    : '';

  wrap.innerHTML = `
    <div class="mystrip-card" data-matchup-key="${escapeAttr(battleMatchupKey_(match, current))}">
      <span class="mystrip-star">★</span>
      <div class="mystrip-team is-me" data-side="${iAmHome ? 'home' : 'away'}">
        ${recapLogo_(team, 'mystrip-logo')}
        <div class="mystrip-name"><strong>${escapeHtml(team ? team.name : 'My team')}</strong><span>My team · Week ${current}</span></div>
        <b class="mystrip-score">${number2(iAmHome ? match.homeScore : match.awayScore)}</b>
      </div>
      <span class="mystrip-vs">VS</span>
      <div class="mystrip-team is-opp" data-side="${iAmHome ? 'away' : 'home'}">
        <b class="mystrip-score">${number2(iAmHome ? match.awayScore : match.homeScore)}</b>
        <div class="mystrip-name is-right"><strong>${escapeHtml(opponent ? opponent.name : 'Opponent')}</strong><span>${escapeHtml(recapRecordText_(opponent))}</span></div>
        ${recapLogo_(opponent, 'mystrip-logo')}
      </div>
      <div class="mystrip-meta">${statusHtml}${lastWeekHtml}<button type="button" class="my-strip-ghost" data-mine-pick>Change</button></div>
    </div>`;

  wrap.querySelector('[data-mine-pick]').addEventListener('click', openTeamPicker_);

  // Quietly fetch last week's result (cached) once the first screen is done.
  if (!summary && !state.myWeekTimer) {
    state.myWeekTimer = window.setTimeout(() => {
      state.myWeekTimer = null;
      ensureMyWeekData_();
    }, 1200);
  }
}

function applyMyTeamHighlights_() {
  const myId = getMyTeamId_();
  const toggle = (element, on) => element.classList.toggle('is-mine', Boolean(on));

  document
    .querySelectorAll('.overview-matchup-card[data-matchup-key], .battle-card[data-matchup-key], .motw-stage[data-matchup-key]')
    .forEach(element => toggle(element, myId && keyTeamIds_(element.dataset.matchupKey).includes(myId)));

  document.querySelectorAll('tr[data-team-id]').forEach(row => toggle(row, myId && Number(row.dataset.teamId) === myId));
  document.querySelectorAll('.team-card[data-team-id]').forEach(card => toggle(card, myId && Number(card.dataset.teamId) === myId));
  document.querySelectorAll('.recap-result[data-team-ids]').forEach(row => {
    toggle(row, myId && row.dataset.teamIds.split(',').map(Number).includes(myId));
  });
}

function openTeamPicker_() {
  const dialog = document.getElementById('teamPicker');
  if (!dialog || !state.teams.length) return;

  const myId = getMyTeamId_();

  dialog.innerHTML = `
    <button class="modal-close" type="button" data-picker-close aria-label="Close">×</button>
    <div class="picker-head">
      <span class="section-kicker">★ My team</span>
      <h2>Which team is yours?</h2>
      <p>Saved on this device only. No login, nothing is sent anywhere.</p>
    </div>
    <div class="picker-grid">
      ${state.teams.map(team => `
        <button type="button" class="picker-team ${team.id === myId ? 'is-selected' : ''}" data-picker-team="${team.id}">
          ${recapLogo_(team, 'picker-logo')}
          <span><strong>${escapeHtml(team.name)}</strong><small>${escapeHtml(ownerText(team))}</small></span>
        </button>`).join('')}
    </div>
    ${myId ? '<div class="picker-foot"><button type="button" class="picker-clear" data-picker-clear>Stop following</button></div>' : ''}`;

  dialog.querySelector('[data-picker-close]').addEventListener('click', () => dialog.close());

  dialog.querySelectorAll('[data-picker-team]').forEach(button => {
    button.addEventListener('click', () => {
      setMyTeamId_(Number(button.dataset.pickerTeam));
      dialog.close();
    });
  });

  const clear = dialog.querySelector('[data-picker-clear]');
  if (clear) clear.addEventListener('click', () => { setMyTeamId_(null); dialog.close(); });

  dialog.showModal();
}

function recapMyStory_(recap) {
  const myId = getMyTeamId_();
  if (!myId || !recap || !Array.isArray(recap.rows)) return null;

  const row = recap.rows.find(item => Number(item.teamId) === myId);
  if (!row) return null;

  const team = state.teamMap.get(myId);
  const opponent = state.teamMap.get(Number(row.opponentId));

  const bits = [`${number2(row.score)} was ${recapOrdinal_(row.rank)} of ${recap.teamCount} scorers`];
  if (row.efficiency != null) bits.push(`${Math.round(row.efficiency)}% lineup efficiency`);

  if (row.projectionRatio != null) {
    const delta = Math.round((row.projectionRatio - 1) * 100);
    bits.push(`${delta >= 0 ? '+' : ''}${delta}% vs projection`);
  }

  return {
    mine: true,
    tone: row.result === 'L' ? 'bad' : 'win',
    icon: '★',
    label: 'Your week',
    title: escapeHtml(myResultText_(row)),
    body: `${escapeHtml(team ? team.name : 'Your team')} vs ${escapeHtml(opponent ? opponent.name : 'your opponent')}. ${escapeHtml(bits.join(' · '))}.`
  };
}

/* ---------- phone: story progress + tap to advance ---------- */

function bindRecapStories_(section) {
  const row = section.querySelector('[data-recap-stories]');
  const segments = Array.from(section.querySelectorAll('.recap-progress i'));
  if (!row || !segments.length) return;

  const cards = Array.from(row.children);

  const update = () => {
    const center = row.scrollLeft + row.clientWidth / 2;
    let best = 0;
    let bestDistance = Infinity;

    cards.forEach((card, index) => {
      const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });

    segments.forEach((segment, index) => segment.classList.toggle('is-on', index <= best));
    row.dataset.activeStory = String(best);
  };

  let frame = 0;
  row.addEventListener('scroll', () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; update(); });
  }, { passive: true });

  // On a phone the stories are a swipe row: a tap moves to the next one.
  cards.forEach((card, index) => {
    card.addEventListener('click', () => {
      if (!window.matchMedia || !window.matchMedia('(max-width: 700px)').matches) return;

      const next = cards[(index + 1) % cards.length];
      row.scrollTo({
        left: next.offsetLeft - (row.clientWidth - next.offsetWidth) / 2,
        behavior: motionReduced_() ? 'auto' : 'smooth'
      });
    });
  });

  update();
}

/* =========================================================
   SHARE IMAGE
   Draws a 1080x1080 picture straight onto a canvas (no libraries, no
   server) and hands it to the phone's share sheet, or downloads it.
   ========================================================= */

const SHARE_SIZE = 1080;
const SHARE_HEAD = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const SHARE_BODY = 'Inter, "Helvetica Neue", Arial, sans-serif';

function recapShareActionsHtml_() {
  const mine = getMyWeekSummary_();

  return `
    <div class="recap-share-actions" aria-label="Share">
      <button type="button" class="recap-share-btn is-primary" data-share-kind="recap">📤 Share recap</button>
      ${mine ? '<button type="button" class="recap-share-btn" data-share-kind="myweek">★ Share my week</button>' : ''}
      <button type="button" class="recap-share-btn" data-share-link>🔗 Copy link</button>
    </div>`;
}

function shareRoundRect_(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shareFont_(ctx, size, weight, family) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function shareFit_(ctx, text, maxWidth, size, minSize, weight, family) {
  let current = size;
  shareFont_(ctx, current, weight, family);

  while (ctx.measureText(text).width > maxWidth && current > minSize) {
    current -= 2;
    shareFont_(ctx, current, weight, family);
  }

  return current;
}

function shareWrap_(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach(word => {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth || !line) {
      line = trial;
    } else {
      lines.push(line);
      line = word;
    }
  });

  if (line) lines.push(line);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')}…`;
    return kept;
  }

  return lines;
}

function shareInitials_(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
}

function loadShareImage_(source) {
  return new Promise(resolve => {
    if (!source) { resolve(null); return; }

    const image = new Image();
    const timer = window.setTimeout(() => resolve(null), 1800);

    // 'anonymous' keeps the canvas exportable: a logo that cannot be read
    // safely simply falls back to the monogram instead of breaking sharing.
    image.crossOrigin = 'anonymous';
    image.onload = () => { window.clearTimeout(timer); resolve(image); };
    image.onerror = () => { window.clearTimeout(timer); resolve(null); };
    image.src = source;
  });
}

async function shareEnsureFonts_() {
  try {
    if (!document.fonts || !document.fonts.load) return;

    await Promise.race([
      Promise.all([document.fonts.load('800 80px "Barlow Condensed"'), document.fonts.load('700 30px Inter')]),
      wait(1500)
    ]);
  } catch (error) { /* system fonts are fine */ }
}

function shareLogo_(ctx, image, team, x, y, size) {
  ctx.save();
  shareRoundRect_(ctx, x, y, size, size, size * 0.22);
  ctx.clip();

  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = '#f5b728';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#07111f';
    ctx.textAlign = 'center';
    shareFont_(ctx, size * 0.42, 900, SHARE_HEAD);
    ctx.fillText(shareInitials_(team ? team.name : ''), x + size / 2, y + size * 0.66);
    ctx.textAlign = 'left';
  }

  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  shareRoundRect_(ctx, x, y, size, size, size * 0.22);
  ctx.stroke();
}

function shareBackground_(ctx, footerLeft, footerRight) {
  const gradient = ctx.createLinearGradient(0, 0, 0, SHARE_SIZE);
  gradient.addColorStop(0, '#112641');
  gradient.addColorStop(1, '#07111f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SHARE_SIZE, SHARE_SIZE);

  const glow = ctx.createRadialGradient(930, 90, 10, 930, 90, 560);
  glow.addColorStop(0, 'rgba(245,183,40,.30)');
  glow.addColorStop(1, 'rgba(245,183,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SHARE_SIZE, SHARE_SIZE);

  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(245,183,40,.38)';
  shareRoundRect_(ctx, 28, 28, SHARE_SIZE - 56, SHARE_SIZE - 56, 40);
  ctx.stroke();

  ctx.fillStyle = '#7f93ad';
  shareFont_(ctx, 26, 700, SHARE_BODY);
  ctx.textAlign = 'left';
  ctx.fillText(footerLeft, 72, 1010);
  ctx.textAlign = 'right';
  ctx.fillText(footerRight, SHARE_SIZE - 72, 1010);
  ctx.textAlign = 'left';
}

function shareKicker_(ctx, text) {
  ctx.fillStyle = '#f5b728';
  shareFont_(ctx, 28, 800, SHARE_BODY);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
  ctx.fillText(text, 72, 98);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function shareHookRows_(recap) {
  const name = id => recapTeamName_(id);
  const rows = [];

  if (recap.playerOfWeek) {
    rows.push(['PLAYER OF THE WEEK', `${recap.playerOfWeek.name} · ${number2(recap.playerOfWeek.points)} pts`]);
  }

  if (recap.nailBiter) {
    rows.push(['NAIL-BITER', `${name(recap.nailBiter.winnerId)} by ${number2(recap.nailBiter.margin)}`]);
  }

  if (recap.unluckiest) {
    rows.push(['UNLUCKIEST LOSS', `${name(recap.unluckiest.teamId)} · ${number2(recap.unluckiest.score)} (${recapOrdinal_(recap.unluckiest.rank)} best)`]);
  } else if (recap.blowout) {
    rows.push(['BIGGEST BLOWOUT', `${name(recap.blowout.winnerId)} by ${number2(recap.blowout.margin)}`]);
  }

  return rows.slice(0, 3);
}

async function buildShareCanvas_(kind) {
  const recap = state.recap && state.recap.teamOfWeek ? state.recap : state.myWeekRecap;
  if (!recap || !recap.teamOfWeek) throw new Error('The recap is not ready yet.');

  await shareEnsureFonts_();

  const canvas = document.createElement('canvas');
  canvas.width = SHARE_SIZE;
  canvas.height = SHARE_SIZE;
  const ctx = canvas.getContext('2d');

  const week = Number(recap.week);

  if (kind === 'myweek') {
    const summary = getMyWeekSummary_();
    const myId = getMyTeamId_();
    if (!summary || !myId) throw new Error('Pick your team first.');

    const team = state.teamMap.get(myId);
    const opponent = state.teamMap.get(Number(summary.opponentId));
    const logo = await loadShareImage_(team ? getTeamIcon(team) : '');
    const win = summary.result === 'W';
    const loss = summary.result === 'L';

    shareBackground_(ctx, 'Zenni League 2026', recap.complete ? 'FINAL · LOCKED' : 'PROVISIONAL');
    shareKicker_(ctx, `ZENNI LEAGUE · MY WEEK ${week}`);
    shareLogo_(ctx, logo, team, 72, 140, 170);

    ctx.fillStyle = '#ffffff';
    const size = shareFit_(ctx, team ? team.name : 'My team', 700, 92, 54, 800, SHARE_HEAD);
    const lines = shareWrap_(ctx, team ? team.name : 'My team', 700, 2);
    const block = size * 0.98 * lines.length;
    const firstBaseline = 140 + (170 - block) / 2 + size * 0.82;
    lines.forEach((line, index) => ctx.fillText(line, 272, firstBaseline + index * size * 0.98));

    // verdict chip
    ctx.fillStyle = win ? '#4bd384' : loss ? '#ff5a6f' : '#f5b728';
    shareRoundRect_(ctx, 72, 360, 560, 120, 28);
    ctx.fill();
    ctx.fillStyle = '#07111f';
    shareFont_(ctx, 84, 800, SHARE_HEAD);
    ctx.fillText(myResultText_(summary), 108, 448);

    ctx.fillStyle = '#ffd978';
    shareFont_(ctx, 250, 800, SHARE_HEAD);
    ctx.fillText(number2(summary.score), 66, 720);

    ctx.fillStyle = '#c9d6e6';
    shareFont_(ctx, 38, 600, SHARE_BODY);
    ctx.fillText(`vs ${opponent ? opponent.name : 'opponent'}  ${number2(summary.opponentScore)}`, 72, 782);

    const stats = [['WEEK RANK', `#${summary.rank} of ${summary.teamCount}`]];
    if (summary.efficiency != null) stats.push(['LINEUP EFFICIENCY', `${Math.round(summary.efficiency)}%`]);
    if (summary.projectionRatio != null) {
      const delta = Math.round((summary.projectionRatio - 1) * 100);
      stats.push(['VS PROJECTION', `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`]);
    }

    const boxWidth = (SHARE_SIZE - 144 - 24 * (stats.length - 1)) / stats.length;
    stats.forEach(([label, value], index) => {
      const x = 72 + index * (boxWidth + 24);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      shareRoundRect_(ctx, x, 830, boxWidth, 130, 22);
      ctx.fill();
      ctx.fillStyle = '#93a6bd';
      shareFont_(ctx, 20, 800, SHARE_BODY);
      ctx.fillText(label, x + 24, 872);
      ctx.fillStyle = '#ffffff';
      shareFont_(ctx, 62, 800, SHARE_HEAD);
      ctx.fillText(value, x + 24, 936);
    });

    return canvas;
  }

  // ---- league recap card ----
  const top = recap.teamOfWeek;
  const topTeam = state.teamMap.get(Number(top.teamId));
  const logo = await loadShareImage_(topTeam ? getTeamIcon(topTeam) : '');

  shareBackground_(ctx, 'Zenni League 2026', recap.complete ? 'FINAL · LOCKED' : 'PROVISIONAL');
  shareKicker_(ctx, `ZENNI LEAGUE · WEEK ${week} RECAP`);
  shareLogo_(ctx, logo, topTeam, 72, 140, 180);

  ctx.fillStyle = '#f5b728';
  shareFont_(ctx, 26, 800, SHARE_BODY);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillText('TEAM OF THE WEEK', 282, 182);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  ctx.fillStyle = '#ffffff';
  const nameSize = shareFit_(ctx, topTeam ? topTeam.name : 'Team', 700, 92, 54, 800, SHARE_HEAD);
  shareWrap_(ctx, topTeam ? topTeam.name : 'Team', 700, 2).forEach((line, index) => {
    ctx.fillText(line, 282, 262 + index * nameSize * 0.98);
  });

  ctx.fillStyle = '#ffd978';
  shareFont_(ctx, 250, 800, SHARE_HEAD);
  ctx.fillText(number2(top.score), 66, 560);

  const facts = [];
  if (top.result !== 'T') facts.push(`${top.result === 'W' ? 'Won' : 'Lost'} by ${number2(top.margin)}`);
  facts.push(`#1 of ${recap.teamCount} scorers`);
  if (top.efficiency != null) facts.push(`${Math.round(top.efficiency)}% lineup efficiency`);

  ctx.fillStyle = '#c9d6e6';
  shareFit_(ctx, facts.join('  ·  '), 936, 32, 22, 600, SHARE_BODY);
  ctx.fillText(facts.join('  ·  '), 72, 616);

  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(72, 658, SHARE_SIZE - 144, 2);

  shareHookRows_(recap).forEach(([label, text], index) => {
    const y = 712 + index * 98;
    ctx.fillStyle = '#f5b728';
    shareFont_(ctx, 22, 800, SHARE_BODY);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillText(label, 72, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    ctx.fillStyle = '#ffffff';
    shareFit_(ctx, text, 936, 44, 26, 700, SHARE_BODY);
    ctx.fillText(text, 72, y + 46);
  });

  return canvas;
}

function releaseShareUrl_() {
  if (state.shareUrl) {
    URL.revokeObjectURL(state.shareUrl);
    state.shareUrl = null;
  }
  state.shareFile = null;
}

function canNativeShare_(file) {
  try {
    return Boolean(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  } catch (error) {
    return false;
  }
}

function shareStatus_(dialog, text) {
  const status = dialog.querySelector('[data-share-status]');
  if (!status) return;
  status.textContent = text;
  window.clearTimeout(shareStatus_.timer);
  if (text) shareStatus_.timer = window.setTimeout(() => { status.textContent = ''; }, 3000);
}

async function copyPageLink_(button) {
  const url = `${window.location.origin}${window.location.pathname}`;

  try {
    await navigator.clipboard.writeText(url);
    if (button) {
      const original = button.textContent;
      button.textContent = '✓ Link copied';
      window.setTimeout(() => { button.textContent = original; }, 1800);
    }
  } catch (error) {
    window.prompt('Copy this link:', url);
  }
}

async function openShareDialog_(kind) {
  const dialog = document.getElementById('shareModal');
  if (!dialog) return;

  releaseShareUrl_();

  const preview = dialog.querySelector('[data-share-preview]');
  const title = dialog.querySelector('[data-share-title]');
  const actions = dialog.querySelector('[data-share-actions]');

  title.textContent = kind === 'myweek' ? 'Share my week' : 'Share the recap';
  preview.removeAttribute('src');
  preview.hidden = true;
  actions.hidden = true;
  dialog.querySelector('[data-share-loading]').hidden = false;
  shareStatus_(dialog, '');

  if (!dialog.open) dialog.showModal();

  try {
    const canvas = await buildShareCanvas_(kind);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => (result ? resolve(result) : reject(new Error('The image could not be created.'))), 'image/png');
    });

    const week = state.recap && state.recap.week ? state.recap.week : (state.myWeekRecap ? state.myWeekRecap.week : '');
    const filename = `zenni-week-${week}-${kind === 'myweek' ? 'my-week' : 'recap'}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    state.shareFile = file;
    state.shareUrl = URL.createObjectURL(blob);

    preview.src = state.shareUrl;
    preview.hidden = false;
    dialog.querySelector('[data-share-loading]').hidden = true;
    actions.hidden = false;

    const nativeButton = dialog.querySelector('[data-share-native]');
    const downloadLink = dialog.querySelector('[data-share-download]');
    const copyImage = dialog.querySelector('[data-share-copy-image]');
    const copyLink = dialog.querySelector('[data-share-copy-link]');

    nativeButton.hidden = !canNativeShare_(file);
    nativeButton.onclick = async () => {
      try {
        await navigator.share({ files: [file], title: `Zenni League · Week ${week}` });
      } catch (error) {
        if (error && error.name !== 'AbortError') shareStatus_(dialog, 'Sharing was not possible here. Use Download instead.');
      }
    };

    downloadLink.href = state.shareUrl;
    downloadLink.download = filename;

    copyImage.hidden = !(navigator.clipboard && window.ClipboardItem);
    copyImage.onclick = async () => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        shareStatus_(dialog, '✓ Image copied. Paste it into your chat.');
      } catch (error) {
        shareStatus_(dialog, 'Copying images is not allowed here. Use Download instead.');
      }
    };

    copyLink.onclick = async () => {
      await copyPageLink_(null);
      shareStatus_(dialog, '✓ Link copied');
    };

  } catch (error) {
    dialog.querySelector('[data-share-loading]').hidden = false;
    dialog.querySelector('[data-share-loading]').textContent = error && error.message ? error.message : 'The image could not be created.';
  }
}

/* =========================================================
   ZENNI RESILIENCE LAYER
   Startup, retries, browser caches, adaptive polling.
   ========================================================= */

// Per-mode timeouts. Cold Apps Script starts regularly run past 15 seconds,
// so a short timeout turned a slow-but-successful first call into a failure.
const API_TIMEOUT_MS = Object.freeze({
  league: 20000,
  matchups: 20000,
  performance: 25000,
  draftboard: 30000,
  roster: 20000,
  _default: 20000
});

// Retry schedule per mode (delay before each retry).
const API_RETRY_DELAYS_MS = Object.freeze({
  league: [1200, 2800],
  matchups: [1200, 2800],
  performance: [2000],
  draftboard: [3000],
  roster: [1500],
  _default: []
});

const MATCHUPS_BROWSER_CACHE_PREFIX = 'ZENNI_FANTASY_MATCHUPS_V1_';
const MATCHUPS_BROWSER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DRAFT_BROWSER_CACHE_KEY = 'ZENNI_FANTASY_DRAFT_V1';
const DRAFT_BROWSER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SEASON_POOL_CACHE_KEY = 'ZENNI_FANTASY_SEASON_POOL_V1';
const LOADER_SEEN_KEY = 'ZENNI_LOADER_SEEN_V1';

const MATCHUPS_GRACE_MS = 3000;
const SEASON_BOARD_DELAY_MS = 800;
const SEASON_BOARD_CONCURRENCY = 2;

const POLL_LIVE_MS = 60 * 1000;
const POLL_GAMEDAY_MS = 2 * 60 * 1000;
const POLL_IDLE_MS = 5 * 60 * 1000;
const POLL_STALE_RETRY_MS = 20 * 1000;
const REVALIDATE_RETRY_DELAYS_MS = [15000, 45000, 120000];

const apiInflight_ = new Map();

function setLoaderNote_(text) {
  loaderState.note = text;
  const message = document.getElementById('loaderMessage');
  if (message) message.textContent = text;
}

function safeSessionGet_(key) {
  try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
}

function safeSessionSet_(key, value) {
  try { window.sessionStorage.setItem(key, value); } catch (_) { /* ignore */ }
}

function apiRequestKey_(mode, params) {
  const clean = {};
  Object.keys(params || {}).sort().forEach(key => {
    if (key !== '_ts') clean[key] = params[key];
  });
  return `${mode}?${JSON.stringify(clean)}`;
}

/**
 * Every network call goes through here.
 *  - per-mode timeout (see jsonp)
 *  - per-mode retries; a server {ok:false} is retried like a network failure
 *  - identical requests already in flight are shared, not duplicated
 */
function api_(mode, params = {}) {
  const key = apiRequestKey_(mode, params);
  if (apiInflight_.has(key)) return apiInflight_.get(key);

  const delays = API_RETRY_DELAYS_MS[mode] || API_RETRY_DELAYS_MS._default;
  const promise = jsonpWithRetry_(mode, params, delays)
    .finally(() => apiInflight_.delete(key));

  apiInflight_.set(key, promise);
  return promise;
}

/* ---------- matchups browser cache ---------- */

function saveMatchupsBrowserCache_(week, matchups) {
  try {
    localStorage.setItem(
      MATCHUPS_BROWSER_CACHE_PREFIX + Number(week),
      JSON.stringify({ savedAt: Date.now(), matchups })
    );
  } catch (error) {
    console.warn('Unable to save matchups browser cache:', error);
  }
}

function loadMatchupsBrowserCache_(week) {
  try {
    const raw = localStorage.getItem(MATCHUPS_BROWSER_CACHE_PREFIX + Number(week));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed.savedAt || 0);
    const ageMs = Math.max(0, Date.now() - savedAt);

    if (!savedAt || !Array.isArray(parsed.matchups) || ageMs > MATCHUPS_BROWSER_CACHE_MAX_AGE_MS) {
      return null;
    }

    return { matchups: parsed.matchups, savedAt, ageMs };
  } catch (error) {
    return null;
  }
}

/**
 * Adopt a resolved-matchups payload ONLY when it belongs to the week the
 * league currently reports. Returns true when state was updated.
 */
function applyMatchupsPayload_(payload) {
  if (!payload || payload.ok === false || !Array.isArray(payload.matchups) || !payload.matchups.length) {
    return false;
  }

  const week = Number(payload.week || 0);
  const current = Number(state.league && state.league.currentWeek || 0);
  if (!week || week !== current) return false;

  state.currentMatchups = payload.matchups;
  state.weekCache.set(week, payload.matchups);
  state.lastScoreRefreshAt = Date.now();
  state.lastSyncAt = Date.now();
  state.scoresStale = false;
  state.matchupsResolved = true;
  saveMatchupsBrowserCache_(week, payload.matchups);
  return true;
}

/* ---------- draft browser cache (only a COMPLETE draft is cached) ---------- */

function saveDraftBrowserCache_(data) {
  try {
    if (!data || !data.ok || !data.draft || data.draft.status !== 'COMPLETE') return;
    localStorage.setItem(DRAFT_BROWSER_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    console.warn('Unable to save draft browser cache:', error);
  }
}

function loadDraftBrowserCache_() {
  try {
    const raw = localStorage.getItem(DRAFT_BROWSER_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt || !parsed.data || (Date.now() - savedAt) > DRAFT_BROWSER_CACHE_MAX_AGE_MS) return null;

    return parsed.data;
  } catch (error) {
    return null;
  }
}

/* ---------- season record board cache (finished weeks never change) ---------- */

function loadSeasonPoolCache_() {
  try {
    const raw = localStorage.getItem(SEASON_POOL_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveSeasonPoolCache_(cache) {
  try {
    localStorage.setItem(SEASON_POOL_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Unable to save season pool cache:', error);
  }
}

// A week is cacheable only once it is behind the current week. The most
// recent finished week gets a short life so late ESPN stat corrections show up.
function seasonPoolFresh_(entry, week, currentWeek) {
  if (!entry || !Array.isArray(entry.pool)) return false;
  if (Number(week) >= Number(currentWeek)) return false;

  const age = Date.now() - Number(entry.savedAt || 0);
  const maxAge = Number(week) === Number(currentWeek) - 1
    ? 6 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;

  return age >= 0 && age < maxAge;
}

/* ---------- adaptive, visibility-aware score polling ---------- */

function isLikelyGameDay_(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/New_York'
  }).format(date);

  return ['Thu', 'Sat', 'Sun', 'Mon'].includes(weekday);
}

function currentPollDelayMs_() {
  if (state.scoresStale) return POLL_STALE_RETRY_MS;

  const statuses = (Array.isArray(state.currentMatchups) ? state.currentMatchups : [])
    .map(match => String(match && match.status || '').toUpperCase());

  if (statuses.some(status => status === 'LIVE')) return POLL_LIVE_MS;
  if (statuses.length && statuses.every(status => status === 'FINAL')) return POLL_IDLE_MS;

  return isLikelyGameDay_() ? POLL_GAMEDAY_MS : POLL_IDLE_MS;
}

function startCurrentWeekScorePolling_() {
  stopCurrentWeekScorePolling_();
  state.pollingEnabled = true;

  if (!state.visibilityBound) {
    document.addEventListener('visibilitychange', onVisibilityChange_);
    state.visibilityBound = true;
  }

  scheduleNextScorePoll_();
}

function stopCurrentWeekScorePolling_() {
  state.pollingEnabled = false;

  if (state.scoreSyncTimer) {
    window.clearTimeout(state.scoreSyncTimer);
    state.scoreSyncTimer = null;
  }
}

function scheduleNextScorePoll_() {
  if (state.scoreSyncTimer) {
    window.clearTimeout(state.scoreSyncTimer);
    state.scoreSyncTimer = null;
  }

  // A hidden tab never polls. It catches up when it becomes visible again.
  if (!state.pollingEnabled || document.hidden) return;

  state.scoreSyncTimer = window.setTimeout(runScorePoll_, currentPollDelayMs_());
}

async function runScorePoll_() {
  state.scoreSyncTimer = null;
  if (!state.pollingEnabled || document.hidden) return;

  await refreshCurrentWeekMatchups_(true);

  if (state.activeView === 'battle' && state.battleCastOpen) {
    loadBattleFantasyCast_(true);
  }

  scheduleNextScorePoll_();
}

function onVisibilityChange_() {
  if (document.hidden) {
    if (state.scoreSyncTimer) {
      window.clearTimeout(state.scoreSyncTimer);
      state.scoreSyncTimer = null;
    }
    return;
  }

  if (state.leagueDegraded) {
    refreshLeagueInBackground_();
    return;
  }

  if (!state.pollingEnabled) return;

  const age = Date.now() - Number(state.lastScoreRefreshAt || 0);

  if (age > POLL_LIVE_MS) {
    runScorePoll_();
  } else {
    scheduleNextScorePoll_();
  }
}

/* =========================================================
   STARTUP
   ========================================================= */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const audit = FantasyPerf.start('INITIAL init');

  bindUi();

  const cached = loadLeagueBrowserCache_();
  const warm = Boolean(
    cached &&
    cached.data &&
    cached.data.ok &&
    cached.data.league &&
    Array.isArray(cached.data.teams)
  );

  startLeagueLoader({ warm });

  try {
    if (warm) {
      await initFromBrowserCache_(cached);
    } else {
      await initFromNetwork_();
    }

    audit.end({
      success: true,
      teams: state.teams.length,
      currentWeek: state.selectedWeek,
      source: warm ? 'browser-cache' : 'live'
    });

    FantasyPerf.log(
      `MAIN FANTASY PAGE TIME TO READY: ${FantasyPerf.nowFromNav().toFixed(1)} ms (${(FantasyPerf.nowFromNav() / 1000).toFixed(2)} sec)`,
      { source: warm ? 'browser-cache' : 'live' }
    );

  } catch (error) {
    console.error(error);

    setApiStatus(false, 'API Error');
    renderFatalError(error);

    const loaderAudit = FantasyPerf.start('Finish loader error');
    await finishLeagueLoader(false);
    loaderAudit.end();

    audit.fail(error, { success: false });

    FantasyPerf.log(
      `FANTASY PAGE FAILED AFTER: ${FantasyPerf.nowFromNav().toFixed(1)} ms (${(FantasyPerf.nowFromNav() / 1000).toFixed(2)} sec)`
    );
  }
}

/**
 * WARM START: paint immediately from the last good data, then refresh in the
 * background. The page is usable even if ESPN / Apps Script is down.
 */
async function initFromBrowserCache_(cached) {
  const audit = FantasyPerf.start('Startup from browser cache', { cacheAgeMs: cached.ageMs });

  hydrateState(cached.data, { source: 'browser-cache' });

  // Saved scores can be hours old. Do not "animate" the catch-up to fresh data.
  state.motionQuietUntil = Date.now() + MOTION_QUIET_AFTER_WARM_MS;
  state.lastSyncAt = Number(cached.savedAt || 0);

  const week = Number(state.league.currentWeek || 1);
  const cachedMatchups = loadMatchupsBrowserCache_(week);

  if (cachedMatchups && cachedMatchups.matchups.length) {
    state.currentMatchups = cachedMatchups.matchups;
    state.matchupsResolved = cachedMatchupsTrusted_(cachedMatchups);
    state.weekCache.set(week, cachedMatchups.matchups);
  }

  renderAll();
  setApiStatus(false, 'Cached Data · Updating');
  startCurrentWeekScorePolling_();

  audit.end({
    teams: state.teams.length,
    currentMatchups: state.currentMatchups.length,
    matchupsFromCache: Boolean(cachedMatchups)
  });

  // Intentionally NOT awaited.
  refreshLeagueInBackground_();
}

/**
 * COLD START: league and matchups load in PARALLEL. The page renders as soon
 * as the league arrives (matchups get a short grace period, then fill in).
 */
async function initFromNetwork_() {
  setLoaderTarget(22);

  const audit = FantasyPerf.start('Startup league + matchups (parallel)');

  const leaguePromise = api_('league');
  const matchupsPromise = api_('matchups').catch(error => {
    console.warn('Startup matchups request failed:', error);
    return null;
  });

  const data = await leaguePromise;

  if (!data || !data.ok) {
    throw new Error(data && data.error ? data.error : 'League API did not return data.');
  }

  saveLeagueBrowserCache_(data);
  state.lastSyncAt = Date.now();
  setLoaderTarget(58);

  hydrateState(data, { source: 'live' });

  const early = await Promise.race([
    matchupsPromise,
    wait(MATCHUPS_GRACE_MS).then(() => null)
  ]);

  const appliedEarly = applyMatchupsPayload_(early);
  state.scoresStale = !appliedEarly;

  setLoaderTarget(78);

  renderAll();
  startCurrentWeekScorePolling_();

  setLoaderTarget(94);

  setApiStatus(true, appliedEarly ? 'ESPN Connected' : 'Connected · Scores updating');

  audit.end({
    leagueOk: true,
    matchupsWithinGrace: appliedEarly,
    teams: state.teams.length
  });

  await finishLeagueLoader(true);

  matchupsPromise.then(late => {
    if (!late || late === early) return;

    if (applyMatchupsPayload_(late)) {
      setApiStatus(true, 'ESPN Connected');
      if (Number(state.selectedWeek) === Number(state.league.currentWeek)) {
        renderWeek(state.currentMatchups, state.selectedWeek);
      }
    }
  });
}

async function jsonpWithRetry_(mode, params = {}, retryDelays = []) {
  let lastError = null;
  const delays = Array.isArray(retryDelays) ? retryDelays : [];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      FantasyPerf.log(`JSONP ${mode} attempt ${attempt + 1}`, {
        attempt: attempt + 1,
        maxAttempts: delays.length + 1,
        params
      });

      const data = await jsonp(mode, params);

      // A server-side error ({ ok:false }) is retried exactly like a
      // network failure, and its real message is what finally surfaces.
      if (data && data.ok === false) {
        throw new Error(data.error || `The ${mode} request failed.`);
      }

      return data;

    } catch (error) {
      lastError = error;

      FantasyPerf.log(`JSONP ${mode} attempt ${attempt + 1} failed`, {
        attempt: attempt + 1,
        error: error && error.message ? error.message : String(error)
      });

      if (attempt >= delays.length) {
        break;
      }

      if (loaderState.timer && (mode === 'league' || mode === 'matchups')) {
        setLoaderNote_('ESPN is slow to respond — retrying...');
      }

      const delayMs = Number(delays[attempt] || 0);
      if (delayMs > 0) await wait(delayMs);
    }
  }

  throw lastError || new Error(`Unable to load ${mode}.`);
}

function saveLeagueBrowserCache_(data) {
  try {
    localStorage.setItem(
      LEAGUE_BROWSER_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        data
      })
    );

    FantasyPerf.log('Saved last-good league browser cache', {
      teams: Array.isArray(data && data.teams) ? data.teams.length : 0,
      currentWeek: data && data.league ? data.league.currentWeek : null
    });

  } catch (error) {
    console.warn('Unable to save Fantasy league browser cache:', error);
  }
}

function loadLeagueBrowserCache_() {
  try {
    const raw = localStorage.getItem(LEAGUE_BROWSER_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed.savedAt || 0);
    const ageMs = Math.max(0, Date.now() - savedAt);

    if (
      !savedAt ||
      !parsed.data ||
      ageMs > LEAGUE_BROWSER_CACHE_MAX_AGE_MS
    ) {
      return null;
    }

    return {
      data: parsed.data,
      savedAt,
      ageMs
    };

  } catch (error) {
    console.warn('Unable to read Fantasy league browser cache:', error);
    return null;
  }
}


/**
 * Background revalidation after a warm start (or after a failed one).
 * League + matchups load in parallel; failures keep the cached page.
 */
async function refreshLeagueInBackground_() {
  const audit = FantasyPerf.start('BACKGROUND league revalidate');

  try {
    const previousMatchups = state.currentMatchups;
    const previousResolved = state.matchupsResolved;
    const previousWeek = Number(state.league && state.league.currentWeek || 0);

    const leaguePromise = api_('league');
    const matchupsPromise = api_('matchups').catch(() => null);

    const fresh = await leaguePromise;

    if (!fresh || !fresh.ok) {
      throw new Error(
        fresh && fresh.error
          ? fresh.error
          : 'League refresh did not return data.'
      );
    }

    saveLeagueBrowserCache_(fresh);
    state.lastSyncAt = Date.now();
    hydrateState(fresh, { source: 'live' });

    const early = await Promise.race([
      matchupsPromise,
      wait(MATCHUPS_GRACE_MS).then(() => null)
    ]);

    let applied = applyMatchupsPayload_(early);

    // hydrateState swaps in ESPN's lightweight schedule values. If the
    // resolved matchups are not back yet, keep the better cached ones.
    if (!applied && Number(state.league.currentWeek) === previousWeek && previousMatchups && previousMatchups.length) {
      state.currentMatchups = previousMatchups;
      state.matchupsResolved = previousResolved;
      state.weekCache.set(previousWeek, previousMatchups);
    }

    state.scoresStale = !applied;
    state.leagueDegraded = false;
    state.revalidateAttempts = 0;

    renderAll({ preserveSelections: true });

    setApiStatus(true, applied ? 'ESPN Connected' : 'Connected · Scores updating');

    matchupsPromise.then(late => {
      if (!late || late === early) return;

      if (applyMatchupsPayload_(late)) {
        setApiStatus(true, 'ESPN Connected');
        if (Number(state.selectedWeek) === Number(state.league.currentWeek)) {
          renderWeek(state.currentMatchups, state.selectedWeek);
        }
      }
    });

    audit.end({ success: true, refreshedUi: true, matchupsApplied: applied });

  } catch (error) {
    audit.fail(error, { success: false, cachedPageStillUsable: true });

    state.leagueDegraded = true;
    setApiStatus(false, 'Cached Data · Reconnecting');

    const delay = REVALIDATE_RETRY_DELAYS_MS[state.revalidateAttempts];
    state.revalidateAttempts += 1;

    if (delay != null) {
      window.setTimeout(() => {
        if (state.leagueDegraded && !document.hidden) refreshLeagueInBackground_();
      }, delay);
    }
  }
}

/**
 * The draft is only fetched when someone opens the Draft tab. A COMPLETE
 * draft is cached in the browser, so repeat visits are instant.
 */
async function ensureDraftLoaded_(force = false) {
  if (!force && (state.draft || state.draftLoadState === 'loading')) return;

  state.draftLoadState = 'loading';

  if (!force) {
    const cachedDraft = loadDraftBrowserCache_();

    if (cachedDraft) {
      hydrateDraftState(cachedDraft);

      if (state.draft) {
        state.draftLoadState = 'ready';
        return;
      }
    }
  }

  if (!state.draft) renderDraftDay();

  const audit = FantasyPerf.start('LAZY draftboard');

  try {
    const draftData = await api_('draftboard');

    hydrateDraftState(draftData);
    state.draftLoadState = state.draft ? 'ready' : 'error';
    saveDraftBrowserCache_(draftData);

    audit.end({
      success: Boolean(draftData && draftData.ok),
      picks: Number(draftData && draftData.draft && Array.isArray(draftData.draft.picks) ? draftData.draft.picks.length : 0)
    });

  } catch (error) {
    audit.fail(error, { success: false });
    console.warn('Draftboard load failed:', error);

    state.draftLoadState = state.draft ? 'ready' : 'error';
    if (!state.draft) renderDraftDay();
  }
}

function startLeagueLoader(options = {}) {
  const loader = document.getElementById('leagueLoader');
  if (!loader) return;

  // WARM START: cached data exists, so the belt animation would only delay a
  // page that is already ready. Remove it before it can flash.
  if (options.warm) {
    loaderState.disabled = true;
    document.documentElement.classList.remove('has-warm-cache');
    loader.remove();
    document.body.classList.remove('is-loading');
    return;
  }

  // COLD START: the head script may have hidden the loader for a cache we
  // then rejected (expired / corrupt). Make sure it is visible again.
  document.documentElement.classList.remove('has-warm-cache');

  // Already saw the full animation this session -> do not make people wait.
  loaderState.minimumMs = safeSessionGet_(LOADER_SEEN_KEY) ? 0 : LOADER_MINIMUM_MS;

  document.body.classList.add('is-loading');

  updateLoaderUi(4);
  loaderState.target = 16;

  loaderState.timer = window.setInterval(() => {
    // While waiting on a slow ESPN response, creep the bar forward so the
    // loader never looks frozen (it stops well before the next stage).
    if (loaderState.progress >= loaderState.target) {
      if (loaderState.target < 40) {
        loaderState.target += 0.05;
      } else {
        return;
      }
    }

    const remaining = loaderState.target - loaderState.progress;
    const step = Math.max(.35, Math.min(1.8, remaining * .08));
    updateLoaderUi(Math.min(loaderState.target, loaderState.progress + step));
  }, 55);
}

function setLoaderTarget(value) {
  loaderState.target = Math.max(loaderState.target, Math.min(96, Number(value) || 0));
}

function updateLoaderUi(value) {
  loaderState.progress = Math.max(0, Math.min(100, value));

  const percent = document.getElementById('loaderPercent');
  const bar = document.getElementById('loaderProgressBar');
  const stage = document.getElementById('loaderStage');
  const message = document.getElementById('loaderMessage');

  if (percent) percent.textContent = `${Math.round(loaderState.progress)}%`;
  if (bar) bar.style.width = `${loaderState.progress}%`;

  const currentStage = loaderState.stages
    .slice()
    .reverse()
    .find(item => loaderState.progress >= item.at);

  if (currentStage) {
    if (stage) stage.textContent = currentStage.text;
    if (message) message.textContent = loaderState.note || currentStage.message;
  }
}

async function finishLeagueLoader(success) {
  const loader = document.getElementById('leagueLoader');
  if (!loader || loaderState.disabled) return;

  loaderState.note = null;

  if (loaderState.timer) {
    window.clearInterval(loaderState.timer);
    loaderState.timer = null;
  }

  const headline = document.getElementById('loaderHeadline');
  const message = document.getElementById('loaderMessage');
  const stage = document.getElementById('loaderStage');

  if (success) {
    if (headline) headline.textContent = 'WELCOME TO ZENNI LEAGUE';
    safeSessionSet_(LOADER_SEEN_KEY, '1');
    if (message) message.textContent = 'The championship race begins now.';
    if (stage) stage.textContent = 'Ready';
  } else {
    if (headline) headline.textContent = 'ZENNI LEAGUE';
    if (message) message.textContent = 'ESPN connection issue — opening the league shell.';
    if (stage) stage.textContent = 'Limited data mode';
  }

  loaderState.target = 100;

  const instant = Number(loaderState.minimumMs) === 0;

  if (instant) {
    updateLoaderUi(100);
  } else {
    while (loaderState.progress < 100) {
      updateLoaderUi(Math.min(100, loaderState.progress + 3.4));
      await wait(18);
    }
  }

  const elapsed = Date.now() - loaderState.startedAt;
  if (elapsed < loaderState.minimumMs) {
    await wait(loaderState.minimumMs - elapsed);
  }

  loader.classList.add(success ? 'is-ready' : 'is-error');

  await wait(instant ? 120 : 420);

  loader.classList.add('is-hidden');
  document.body.classList.remove('is-loading');

  window.setTimeout(() => {
    loader.remove();
  }, 900);
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function bindUi() {
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.tab));
  });

  document.querySelectorAll('[data-tab-open]').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.tabOpen));
  });

  document.querySelectorAll('[data-tab-target]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      switchView(link.dataset.tabTarget);
    });
  });

  document.querySelectorAll('[data-mine-pick]').forEach(button => button.addEventListener('click', openTeamPicker_));

  const picker = document.getElementById('teamPicker');
  if (picker) picker.addEventListener('click', event => { if (event.target === picker) picker.close(); });

  const shareModal = document.getElementById('shareModal');
  if (shareModal) {
    shareModal.addEventListener('click', event => { if (event.target === shareModal) shareModal.close(); });
    shareModal.addEventListener('close', releaseShareUrl_);
  }

  const staleRetry = document.querySelector('[data-stale-retry]');
  if (staleRetry) {
    staleRetry.addEventListener('click', () => {
      if (state.leagueDegraded) {
        refreshLeagueInBackground_();
      } else {
        refreshCurrentWeekMatchups_(true);
      }
    });
  }

  if (!state.freshnessTimer) {
    state.freshnessTimer = window.setInterval(renderApiFreshness_, 30000);
  }

  const recapOpen = document.getElementById('recapOpen');
  if (recapOpen) {
    recapOpen.addEventListener('click', () => {
      state.recapForced = true;
      syncRecapState_();
      const section = document.getElementById('weekRecap');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  document.getElementById('prevWeek').addEventListener('click', () => changeWeek(-1));
  document.getElementById('nextWeek').addEventListener('click', () => changeWeek(1));
  document.getElementById('battlePrevWeek').addEventListener('click', () => changeWeek(-1));
  document.getElementById('battleNextWeek').addEventListener('click', () => changeWeek(1));

  document.getElementById('awardsPrevWeek')?.addEventListener('click', () => changeAwardsWeek_(-1));
  document.getElementById('awardsNextWeek')?.addEventListener('click', () => changeAwardsWeek_(1));

  document.getElementById('gradesWeekTabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-grades-week]');
    if (!button || button.disabled) return;
    changeGradesWeek_(Number(button.dataset.gradesWeek || 1));
  });

  const modal = document.getElementById('teamModal');
  document.getElementById('modalClose').addEventListener('click', () => modal.close());

  modal.addEventListener('click', event => {
    if (event.target === modal) modal.close();
  });
}

function switchView(view) {
  const nextView = ['overview', 'battle', 'grades', 'awards', 'standings', 'teams', 'draft'].includes(view)
    ? view
    : 'overview';

  state.activeView = nextView;

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.toggle('is-active', panel.dataset.view === nextView);
  });

  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === nextView;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (nextView === 'awards') {
    renderWeeklyAwards_(state.awardsWeek || getDefaultAwardsWeek_());
    scheduleSeasonBoard_();
  }

  if (nextView === 'grades') {
    changeGradesWeek_(state.gradesWeek || Number(state.league && state.league.currentWeek || 1), true);
  }

  if (nextView === 'battle') {
    animateBattleEntrance();

    window.setTimeout(() => {
      startBattleFightLoop_();
      loadBattleFantasyCast_();
    }, 850);
  } else {
    stopBattleFightLoop_();
    stopBattleFantasyCastPolling_();
  }

  if (nextView === 'draft') {
    ensureDraftLoaded_();
    if (state.draft) renderDraftDay();
  }
}

function hydrateState(data, options = {}) {
  state.league = data.league;
  state.teams = Array.isArray(data.teams) ? data.teams : [];
  state.teamMap = new Map(state.teams.map(team => [Number(team.id), team]));
  state.standings = Array.isArray(data.standings) ? data.standings : [];
  state.currentMatchups = Array.isArray(data.currentMatchups) ? data.currentMatchups : [];
  state.matchupsResolved = false;
  state.selectedWeek = Number(data.league.currentWeek || 1);
  state.weekCache.set(state.selectedWeek, state.currentMatchups);

  document.getElementById('heroWeek').textContent = state.league.currentWeek;
  document.getElementById('heroTeams').textContent = state.league.teamCount;
  document.getElementById('heroPlayoffs').textContent = state.league.playoffTeams;

  const generated = data.generatedAt ? new Date(data.generatedAt) : new Date();
  document.getElementById('lastUpdated').textContent =
    `Last ESPN sync: ${generated.toLocaleString()}${options.source === 'browser-cache' ? ' (cached)' : ''}`;

  const preseason = Number(state.league.latestScoringPeriod || 0) < 1;
  document.getElementById('standingsNote').textContent = preseason
    ? 'Preseason — rankings begin after Week 1'
    : `Through Week ${state.league.latestScoringPeriod}`;

  document.getElementById('heroSubtext').textContent = preseason
    ? 'The field is set. Twelve teams. One Zenni Cup.'
    : `Live through Week ${state.league.latestScoringPeriod}.`;
}

function hydrateDraftState(data) {
  if (!data || !data.ok) {
    state.draft = null;
    return;
  }

  // API may return either {draft:{...}} or the normalized draft object directly.
  state.draft = data.draft && data.draft.order ? data.draft : data;
  state.draftRanking = data.ranking || null;

  const source = document.getElementById('draftRankingSource');
  if (source) {
    source.textContent = state.draftRanking && state.draftRanking.rankType
      ? `ESPN ${state.draftRanking.rankType} ADP ranking`
      : 'ESPN ADP ranking';
  }

  renderDraftDay();
}

function renderDraftDay() {
  const grid = document.getElementById('draftOrderGrid');
  if (!grid) return;

  const draft = state.draft;
  if (!draft) {
    if (state.draftLoadState === 'error') {
      grid.classList.remove('skeleton-block');
      grid.innerHTML = '<div class="draft-error">The draft board could not be loaded. <button type="button" class="performer-tab" data-draft-retry>Retry</button></div>';
      const retry = grid.querySelector('[data-draft-retry]');
      if (retry) retry.addEventListener('click', () => ensureDraftLoaded_(true));
    } else {
      grid.classList.add('skeleton-block');
      grid.innerHTML = '<div class="draft-error">Loading the draft board…</div>';
    }
    return;
  }

  const order = Array.isArray(draft.order) ? draft.order : [];
  const picks = Array.isArray(draft.picks) ? draft.picks : [];
  const date = draft.dateIso ? new Date(draft.dateIso) : null;

  const dateLabel = document.getElementById('draftDateLabel');
  if (dateLabel) dateLabel.textContent = draft.dateLocal || (date ? date.toLocaleString() : 'Draft schedule pending');

  setText('draftType', draft.type || 'SNAKE');
  setText('draftTeamCount', draft.teamCount || order.length || 12);
  setText('draftPickTimer', draft.secondsPerPick ? `${draft.secondsPerPick} sec` : '—');
  setText('draftSlots', draft.totalPickSlots || picks.length || '—');

  const rounds = draft.rounds || ((draft.totalPickSlots && draft.teamCount) ? Math.ceil(draft.totalPickSlots / draft.teamCount) : null);
  setText('draftRounds', rounds || '—');
  setText('draftLockLabel', draft.orderLocked ? 'Order Locked' : 'Order Pending');

  updateDraftStatus(draft.status || 'PRE_DRAFT');
  startDraftCountdown(date, draft.status || 'PRE_DRAFT');

  grid.classList.remove('skeleton-block');
  grid.innerHTML = order.map(entry => {
    const team = state.teamMap.get(Number(entry.teamId));
    const displayTeam = team || { id: entry.teamId, name: entry.teamName, owners: entry.owners || [], logo: '' };
    const isChampion = !!(team && team.defendingChampion);
    return `
      <article class="draft-order-card ${isChampion ? 'is-champion' : ''}">
        <div class="draft-pick-number"><small>Pick</small><strong>${entry.pick}</strong></div>
        <img class="draft-team-art ${teamIconClass(displayTeam)}" src="${escapeAttr(getTeamIcon(displayTeam))}" alt="${escapeAttr(displayTeam.name)} mascot" ${teamIconFallbackAttr(displayTeam)}>
        <div class="draft-team-copy">
          <span>${isChampion ? 'Defending Champion' : '2026 Draft Position'}</span>
          <h3>${escapeHtml(displayTeam.name || entry.teamName)}</h3>
          <p>${escapeHtml(ownerText(displayTeam))}</p>
        </div>
      </article>`;
  }).join('');

  renderDraftBoard(picks, rounds || 1);
}

function renderDraftBoard(picks, rounds) {
  const tabs = document.getElementById('draftRoundTabs');
  const board = document.getElementById('draftPickBoard');
  if (!tabs || !board) return;

  const maxRound = Math.max(1, Math.min(Number(rounds || 1), 17));
  state.draftRound = Math.max(1, Math.min(state.draftRound || 1, maxRound));

  tabs.innerHTML = Array.from({ length: maxRound }, (_, index) => {
    const round = index + 1;
    return `<button type="button" class="draft-round-button ${round === state.draftRound ? 'is-active' : ''}" data-draft-round="${round}">R${round}</button>`;
  }).join('');

  tabs.querySelectorAll('[data-draft-round]').forEach(button => {
    button.addEventListener('click', () => {
      state.draftRound = Number(button.dataset.draftRound);
      renderDraftBoard(picks, maxRound);
    });
  });

  const roundPicks = picks.filter(pick => Number(pick.round) === Number(state.draftRound));

  board.innerHTML = roundPicks.map(pick => {
    const team = state.teamMap.get(Number(pick.teamId));
    const displayTeam = team || { id: pick.teamId, name: pick.teamName, owners: [], logo: '' };

    if (!pick.completed) {
      return `
        <article class="draft-slot">
          <div class="draft-slot-pick">${pick.overallPick}</div>
          <img src="${escapeAttr(getTeamIcon(displayTeam))}" alt="" ${teamIconFallbackAttr(displayTeam)}>
          <div class="draft-slot-team">
            <strong>${escapeHtml(displayTeam.name || pick.teamName)}</strong>
            <span>Waiting for draft</span>
          </div>
        </article>`;
    }

    const player = pick.player || {};
    const resolvedRank = pick.resolvedDraftRank != null ? Number(pick.resolvedDraftRank) : null;
    const positionRank = pick.positionRank != null ? Number(pick.positionRank) : null;
    const adp = pick.espnAdp != null ? Number(pick.espnAdp) : null;
    const value = pick.valueVsEspnRank != null ? Number(pick.valueVsEspnRank) : null;

    return `
      <article class="draft-slot is-complete">
        <div class="draft-slot-pick">${pick.overallPick}</div>

        <img src="${escapeAttr(getTeamIcon(displayTeam))}" alt="" ${teamIconFallbackAttr(displayTeam)}>

        <div class="draft-slot-team">
          <strong>${escapeHtml(displayTeam.name || pick.teamName)}</strong>
          <span>${escapeHtml(pick.playerName || player.name || 'Selected')}</span>
        </div>

        <div class="draft-player-details">
          <div class="draft-player-main">
            <strong>${escapeHtml(pick.playerName || player.name || 'Selected')}</strong>
            <span>
              ${escapeHtml(pick.position || player.position || '')}
              ${positionRank != null ? ` • ${escapeHtml((pick.position || player.position || 'POS') + positionRank)}` : ''}
            </span>
          </div>

          <div class="draft-player-metrics">
            <span>
              <small>ESPN ADP</small>
              <strong>${adp != null ? adp.toFixed(2) : '—'}</strong>
            </span>
            <span>
              <small>ADP Rank</small>
              <strong>${resolvedRank != null ? '#' + resolvedRank : '—'}</strong>
            </span>
            <span>
              <small>Drafted</small>
              <strong>#${pick.overallPick}</strong>
            </span>
          </div>

          <div class="draft-value-badge ${draftValueClass(pick.valueLabel)}">
            ${escapeHtml(pick.valueLabel || 'PICKED')}
            ${value != null ? `<b>${value > 0 ? '+' : ''}${value}</b>` : ''}
          </div>
        </div>
      </article>`;
  }).join('') || '<div class="draft-error">ESPN has not returned pick slots for this round.</div>';

  renderDraftTeamSelector(picks);
  renderDraftTeamRecap(picks);
}

function draftValueClass(label) {
  const value = String(label || '').toUpperCase();
  if (value.includes('STEAL')) return 'is-steal';
  if (value.includes('REACH')) return 'is-reach';
  if (value.includes('VALUE')) return 'is-value';
  return '';
}

function renderDraftTeamSelector(picks) {
  const container = document.getElementById('draftTeamSelector');
  if (!container) return;

  if (!state.draftSelectedTeamId && state.draft && Array.isArray(state.draft.order) && state.draft.order.length) {
    state.draftSelectedTeamId = Number(state.draft.order[0].teamId);
  }

  container.innerHTML = (state.draft.order || []).map(entry => {
    const team = state.teamMap.get(Number(entry.teamId));
    const displayTeam = team || { id: entry.teamId, name: entry.teamName, owners: entry.owners || [], logo: '' };
    const active = Number(state.draftSelectedTeamId) === Number(entry.teamId);

    return `
      <button type="button" class="draft-team-chip ${active ? 'is-active' : ''}" data-draft-team="${entry.teamId}">
        <img src="${escapeAttr(getTeamIcon(displayTeam))}" alt="" ${teamIconFallbackAttr(displayTeam)}>
        <span>${escapeHtml(displayTeam.name || entry.teamName)}</span>
      </button>`;
  }).join('');

  container.querySelectorAll('[data-draft-team]').forEach(button => {
    button.addEventListener('click', () => {
      state.draftSelectedTeamId = Number(button.dataset.draftTeam);
      renderDraftTeamSelector(picks);
      renderDraftTeamRecap(picks);
    });
  });
}

function renderDraftTeamRecap(picks) {
  const container = document.getElementById('draftTeamRecap');
  if (!container) return;

  const teamId = Number(state.draftSelectedTeamId || 0);
  if (!teamId) {
    container.innerHTML = '<div class="draft-error">Select a team to view its draft.</div>';
    return;
  }

  const team = state.teamMap.get(teamId);
  const orderEntry = (state.draft.order || []).find(entry => Number(entry.teamId) === teamId);
  const displayTeam = team || {
    id: teamId,
    name: orderEntry ? orderEntry.teamName : `Team ${teamId}`,
    owners: orderEntry ? orderEntry.owners || [] : [],
    logo: ''
  };

  const teamPicks = (picks || []).filter(pick => Number(pick.teamId) === teamId);

  container.innerHTML = `
    <div class="draft-recap-header">
      <img src="${escapeAttr(getTeamIcon(displayTeam))}" alt="${escapeAttr(displayTeam.name)}" ${teamIconFallbackAttr(displayTeam)}>
      <div>
        <span class="section-kicker">2026 Draft Recap</span>
        <h3>${escapeHtml(displayTeam.name)}</h3>
        <p>${escapeHtml(ownerText(displayTeam))}</p>
      </div>
    </div>

    <div class="draft-recap-table">
      <div class="draft-recap-row draft-recap-head">
        <span>Round</span>
        <span>Pick</span>
        <span>Player</span>
        <span>Pos</span>
        <span>ESPN ADP</span>
        <span>ADP Rank</span>
        <span>Value</span>
      </div>

      ${teamPicks.map(pick => `
        <div class="draft-recap-row ${pick.completed ? 'is-complete' : ''}">
          <span>${pick.round}</span>
          <span>#${pick.overallPick}</span>
          <span class="recap-player">${pick.completed ? escapeHtml(pick.playerName || (pick.player && pick.player.name) || 'Selected') : 'Waiting'}</span>
          <span>${pick.completed ? escapeHtml(pick.position || (pick.player && pick.player.position) || '—') : '—'}</span>
          <span>${pick.completed && pick.espnAdp != null ? Number(pick.espnAdp).toFixed(2) : '—'}</span>
          <span>${pick.completed && pick.resolvedDraftRank != null ? '#' + pick.resolvedDraftRank : '—'}</span>
          <span class="${pick.completed ? draftValueClass(pick.valueLabel) : ''}">
            ${pick.completed ? escapeHtml(pick.valueLabel || 'PICKED') : '—'}
          </span>
        </div>
      `).join('')}
    </div>`;
}

function startDraftCountdown(date, status) {
  if (state.draftCountdownTimer) {
    window.clearInterval(state.draftCountdownTimer);
    state.draftCountdownTimer = null;
  }

  const tick = () => {
    if (!date || Number.isNaN(date.getTime())) return;
    const diff = date.getTime() - Date.now();

    if (diff <= 0) {
      setText('draftDays', '00');
      setText('draftHours', '00');
      setText('draftMinutes', '00');
      setText('draftSeconds', '00');
      updateDraftStatus(status === 'COMPLETE' ? 'COMPLETE' : status === 'LIVE' ? 'LIVE' : 'STARTING');

      // Nothing left to count down: stop ticking every second forever.
      if (state.draftCountdownTimer) {
        window.clearInterval(state.draftCountdownTimer);
        state.draftCountdownTimer = null;
      }
      return;
    }

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    setText('draftDays', String(days).padStart(2, '0'));
    setText('draftHours', String(hours).padStart(2, '0'));
    setText('draftMinutes', String(minutes).padStart(2, '0'));
    setText('draftSeconds', String(seconds).padStart(2, '0'));
  };

  tick();
  state.draftCountdownTimer = window.setInterval(tick, 1000);
}

function updateDraftStatus(status) {
  const pill = document.getElementById('draftStatusPill');
  if (!pill) return;
  const normalized = String(status || 'PRE_DRAFT').toUpperCase();
  pill.className = `draft-status-pill status-${normalized.toLowerCase().replaceAll('_', '-')}`;
  pill.textContent = normalized === 'PRE_DRAFT' ? 'PRE-DRAFT' : normalized.replaceAll('_', ' ');
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderAll(options = {}) {
  renderChampionSpotlight();
  renderStandings();
  renderStandingsPreview();
  renderTeamGallery();
  renderGlanceRibbon();

  // A background refresh must not yank the user back to a different week.
  if (!options.preserveSelections) {
    state.awardsWeek = getDefaultAwardsWeek_();
    state.gradesWeek = Number(state.league && state.league.currentWeek || state.selectedWeek || 1);
  }

  renderGradesWeekTabs_();

  // The season record book lives in the Weekly Awards tab now, so it only
  // loads when someone is actually looking at it.
  if (state.activeView === 'awards') scheduleSeasonBoard_();

  renderWeek(state.currentMatchups, state.selectedWeek);
}

function renderWeek(matchups, week) {
  state.selectedWeek = Number(week);
  syncWeekLabels(week);
  renderOverviewMatchups(matchups, week);
  renderFeaturedMatchup(matchups, week);
  renderBattleCenter(matchups, week);

  // The strip is drawn BEFORE the motion pass so its scores can animate too.
  if (Number(week) === Number(state.league && state.league.currentWeek)) renderMyTeamStrip_();

  applyMatchupMotion_(matchups, week);
  applyMyTeamHighlights_();

  // Grades are expensive (a full-roster request). Only build them while the
  // Grades tab is actually open; opening the tab loads them on demand.
  if (state.activeView === 'grades' && Number(state.gradesWeek || week) === Number(week)) {
    renderWeeklyTeamGrades(matchups, week);
  }

  // The recap decides for itself whether it should be on screen.
  if (Number(week) === Number(state.league && state.league.currentWeek)) {
    syncRecapState_();
  }
}

function syncWeekLabels(week) {
  document.getElementById('featuredWeek').textContent = `Week ${week}`;
  document.getElementById('overviewWeekLabel').textContent = `Week ${week}`;
  document.getElementById('battleWeekLabel').textContent = `Week ${week}`;
  document.getElementById('battleCardWeek').textContent = week;
}

function renderChampionSpotlight() {
  const champion = state.teams.find(team => team.defendingChampion);
  const container = document.getElementById('championSpotlight');

  if (!container) return;

  if (!champion) {
    container.innerHTML = '<div class="error-panel">No defending champion was found.</div>';
    return;
  }

  const icon = getTeamIcon(champion);
  container.innerHTML = `
    <div class="spotlight-header">
      <span class="section-kicker">Champion Spotlight</span>
    </div>
    <div class="spotlight-art-wrap">
      <img class="spotlight-art ${teamIconClass(champion)}" src="${escapeAttr(icon)}" alt="${escapeAttr(champion.name)} mascot" ${teamIconFallbackAttr(champion)}>
    </div>
    <div class="spotlight-identity">
      <div class="spotlight-mini-badge">
        <img class="spotlight-badge-icon ${teamIconClass(champion)}" src="${escapeAttr(icon)}" alt="" ${teamIconFallbackAttr(champion)}>
      </div>
      <div>
        <h3>${escapeHtml(champion.name)}</h3>
        <p>${escapeHtml(ownerText(champion))}</p>
      </div>
    </div>
    <div class="spotlight-meta">2025 Zenni League Champion</div>
    <div class="spotlight-footer">
      <span class="section-kicker">Defending Champion</span>
      <div class="spotlight-titlecount">
        <strong>${escapeHtml(String(champion.championships || 1))}×</strong>
        <small>Champion</small>
      </div>
    </div>
  `;
}


function getDefaultAwardsWeek_() {
  const latest = Number(state.league && state.league.latestScoringPeriod || 0);
  const current = Number(state.league && state.league.currentWeek || 1);
  return Math.max(1, latest || Math.max(1, current - 1));
}

function currentWeekHasPoints_() {
  return (Array.isArray(state.currentMatchups) ? state.currentMatchups : [])
    .some(match => String(match && match.status || '').toUpperCase() !== 'SCHEDULED');
}

function scheduleSeasonBoard_() {
  const currentWeek = Number(state.league && state.league.currentWeek || 1);
  const latest = Number(state.league && state.league.latestScoringPeriod || 0);
  const key = `${currentWeek}|${latest}|${currentWeekHasPoints_() ? 1 : 0}`;

  // Already built for exactly this league state.
  if (state.seasonBoardKey === key && state.allTimePerformanceCache) return;

  state.seasonBoardKey = key;

  if (state.seasonBoardTimer) window.clearTimeout(state.seasonBoardTimer);

  // Everything cached -> paint right now, no network involved. Only a board
  // that must ask Apps Script for historical weeks waits for the first
  // screen to finish loading.
  const delay = seasonBoardNeedsNetwork_() ? SEASON_BOARD_DELAY_MS : 0;

  state.seasonBoardTimer = window.setTimeout(() => {
    state.seasonBoardTimer = null;
    renderAllTimeTopStats_();
  }, delay);
}

function seasonBoardNeedsNetwork_() {
  const currentWeek = Math.max(1, Number(state.league && state.league.currentWeek || 1));
  const lastWeek = currentWeekHasPoints_() ? currentWeek : Math.max(1, currentWeek - 1);
  const poolCache = loadSeasonPoolCache_();

  for (let week = 1; week <= lastWeek; week += 1) {
    if (!seasonPoolFresh_(poolCache[String(week)], week, currentWeek)) return true;
  }

  return false;
}

function pooledStartersForWeek_(snapshots, week) {
  const pool = [];

  snapshots.forEach(snapshot => {
    const { team, roster } = snapshot;

    roster.forEach(player => {
      if (player.isStarter !== true) return;

      const points = getWeeklyPlayerPoints(player, week);
      const position = normalizeFantasyPosition(player.position || player.lineupSlot);
      const lineupSlot = normalizeTopPerformerSlot_(player.lineupSlot || player.slot);

      if (!position || points == null) return;

      pool.push({
        playerId: Number(player.playerId || player.id || 0),
        name: player.name || 'Unknown Player',
        position,
        lineupSlot,
        points,
        week,
        nflTeam: getPlayerNflTeam(player),
        fantasyTeamId: Number(team.id)
      });
    });
  });

  return pool;
}

async function renderAllTimeTopStats_() {
  const container = document.getElementById('overviewTopStats');
  if (!container) return;
  const requestToken = ++state.allTimeRequestToken;

  const currentWeek = Math.max(1, Number(state.league && state.league.currentWeek || 1));

  // A week that has not kicked off has no points to rank yet.
  const lastWeek = currentWeekHasPoints_() ? currentWeek : Math.max(1, currentWeek - 1);

  const poolCache = loadSeasonPoolCache_();
  const poolsByWeek = new Map();
  const weeksToLoad = [];
  const missingWeeks = [];

  for (let week = 1; week <= lastWeek; week += 1) {
    const entry = poolCache[String(week)];

    if (seasonPoolFresh_(entry, week, currentWeek)) {
      poolsByWeek.set(week, entry.pool);
    } else {
      weeksToLoad.push(week);
    }
  }

  const teamName = id => {
    const team = state.teamMap.get(Number(id));
    return team ? team.name : `Team ${id}`;
  };

  const paint = () => {
    const seasonPool = [];

    Array.from(poolsByWeek.keys()).sort((a, b) => a - b).forEach(week => {
      poolsByWeek.get(week).forEach(item => {
        seasonPool.push({ ...item, fantasyTeam: teamName(item.fantasyTeamId) });
      });
    });

    state.allTimeMissingWeeks = missingWeeks.slice().sort((a, b) => a - b);
    state.allTimePerformanceCache = seasonPool;

    container.classList.remove('skeleton-block');
    renderAllTimePerformerLeaderboard_(container, seasonPool);
  };

  if (poolsByWeek.size) {
    paint();
  } else {
    container.classList.add('skeleton-block');
    container.innerHTML = `
      <div class="performers-loading">
        <strong>Building 2026 season record board...</strong>
        <span>ALL · QB · RB · WR · TE · FLEX · K · D/ST</span>
      </div>
    `;
  }

  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < weeksToLoad.length) {
      const week = weeksToLoad[nextIndex];
      nextIndex += 1;

      try {
        const snapshots = await getWeekRosterSnapshots_(week);
        if (requestToken !== state.allTimeRequestToken) return;

        const pool = pooledStartersForWeek_(snapshots, week);
        poolsByWeek.set(week, pool);

        // Only finished weeks are stored. The live week is never cached.
        if (week < currentWeek) {
          poolCache[String(week)] = { savedAt: Date.now(), pool };
        }
      } catch (error) {
        if (requestToken !== state.allTimeRequestToken) return;
        missingWeeks.push(week);
      }

      if (requestToken !== state.allTimeRequestToken) return;
      paint();
    }
  };

  const workers = [];
  for (let n = 0; n < Math.min(SEASON_BOARD_CONCURRENCY, weeksToLoad.length); n += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  if (requestToken !== state.allTimeRequestToken) return;

  saveSeasonPoolCache_(poolCache);

  if (!poolsByWeek.size) {
    container.classList.remove('skeleton-block');
    container.innerHTML = `<div class="performers-empty"><strong>Unable to load season records.</strong><span>Weekly scoring data is temporarily unavailable. Please retry.</span><button type="button" class="performer-tab" data-retry-season>Retry</button></div>`;
    container.querySelector('[data-retry-season]').addEventListener('click', () => renderAllTimeTopStats_());
    return;
  }

  paint();
}

function renderAllTimePerformerLeaderboard_(container, playerPool) {
  const categories = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'];
  let active = String(state.allTimePerformerPosition || 'ALL').toUpperCase();
  if (!categories.includes(active)) active = 'ALL';
  state.allTimePerformerPosition = active;

  const candidates = topPerformerCandidates_(playerPool, active)
    .sort((a, b) => b.points - a.points || a.week - b.week || a.name.localeCompare(b.name));
  const leaders = candidates.slice(0, 5);
  const tabLabel = value => value === 'DST' ? 'D/ST' : value;

  const missingWeeks = state.allTimeMissingWeeks || [];
  container.innerHTML = `
    ${missingWeeks.length ? `<div class="performers-empty compact" role="status"><strong>Showing available weekly records.</strong><span>Week ${missingWeeks.join(', ')} data is unavailable. Rankings may change when those weeks load.</span><button type="button" class="performer-tab" data-retry-season>Retry missing weeks</button></div>` : ''}
    <div class="performer-tabs" role="tablist" aria-label="All-time performer position">
      ${categories.map(category => `<button class="performer-tab ${category === active ? 'is-active' : ''}" type="button" data-alltime-position="${category}">${tabLabel(category)}</button>`).join('')}
    </div>
    <div class="performer-leaderboard-head"><span>${active === 'ALL' ? 'Top 5 Single-Game Performances' : `Top 5 ${tabLabel(active)} Performances`}</span><small>2026 season · starters only</small></div>
    <div class="performer-leaderboard">
      ${leaders.length ? leaders.map((leader, index) => `
        <div class="performer-row ${index === 0 ? 'is-player-week' : ''}">
          <div class="performer-rank">#${index + 1}</div>
          <div class="performer-copy">
            <div class="performer-name-line"><strong>${escapeHtml(leader.name)}</strong>${index === 0 ? '<span class="player-week-badge">Season Record</span>' : ''}</div>
            <span>${escapeHtml(leader.position === 'DST' ? 'D/ST' : leader.position)} · ${escapeHtml(leader.fantasyTeam)} · Week ${leader.week}</span>
          </div>
          <div class="performer-points"><strong>${number2(leader.points)}</strong><small>PTS</small></div>
        </div>`).join('') : `<div class="performers-empty compact"><strong>No qualifying records yet.</strong><span>Records appear after starter points are posted.</span></div>`}
    </div>`;

  const retry = container.querySelector('[data-retry-season]');
  if (retry) retry.addEventListener('click', () => renderAllTimeTopStats_());

  container.querySelectorAll('[data-alltime-position]').forEach(button => {
    button.addEventListener('click', () => {
      state.allTimePerformerPosition = String(button.dataset.alltimePosition || 'ALL').toUpperCase();
      renderAllTimePerformerLeaderboard_(container, playerPool);
    });
  });
}

async function renderWeeklyAwards_(week) {
  const safeWeek = Math.max(1, Number(week || 1));
  state.awardsWeek = safeWeek;
  const requestToken = ++state.awardsRequestToken;
  const label = document.getElementById('awardsWeekLabel');
  if (label) label.textContent = String(safeWeek);

  const maxWeek = Math.max(1, Number(state.league && state.league.currentWeek || 1));
  const prev = document.getElementById('awardsPrevWeek');
  const next = document.getElementById('awardsNextWeek');
  if (prev) prev.disabled = safeWeek <= 1;
  if (next) next.disabled = safeWeek >= maxWeek;

  const performerContainer = document.getElementById('awardsTopStats');
  if (performerContainer) {
    performerContainer.classList.add('skeleton-block');
    performerContainer.innerHTML = `<div class="performers-loading"><strong>Loading Week ${safeWeek} leaders...</strong><span>Top 5 starters by position</span></div>`;
  }

  const pulse = document.getElementById('awardsLeaguePulse');
  if (pulse) pulse.innerHTML = `<div class="performers-loading">Loading Week ${safeWeek} team performance...</div>`;
  try {
    const data = await getWeekPerformance_(safeWeek);
    if (requestToken !== state.awardsRequestToken) return;
    const snapshots = performanceSnapshots_(data);
    renderLeaguePulse(data.matchups, safeWeek, 'awardsLeaguePulse');

    const pool = [];
    snapshots.forEach(snapshot => {
      const { team, roster } = snapshot;
      roster.forEach(player => {
        if (player.isStarter !== true) return;
        const points = getWeeklyPlayerPoints(player, safeWeek);
        const position = normalizeFantasyPosition(player.position || player.lineupSlot);
        const lineupSlot = normalizeTopPerformerSlot_(player.lineupSlot || player.slot);
        if (!position || points == null) return;
        pool.push({ playerId:Number(player.playerId || player.id || 0), name:player.name || 'Unknown Player', position, lineupSlot, points, nflTeam:getPlayerNflTeam(player), fantasyTeam:team.name, fantasyTeamId:Number(team.id) });
      });
    });

    if (performerContainer) {
      performerContainer.classList.remove('skeleton-block');
      const previous = state.topPerformerPosition;
      state.topPerformerPosition = state.awardsPerformerPosition || 'ALL';
      renderTopPerformerLeaderboard_(performerContainer, safeWeek, pool);
      state.awardsPerformerPosition = state.topPerformerPosition;
      state.topPerformerPosition = previous;
      performerContainer.querySelectorAll('[data-performer-position]').forEach(button => {
        button.addEventListener('click', () => { state.awardsPerformerPosition = String(button.dataset.performerPosition || 'ALL').toUpperCase(); }, { capture:true });
      });
    }
  } catch (error) {
    if (requestToken !== state.awardsRequestToken) return;
    if (pulse) pulse.innerHTML = `<div class="performers-empty">Unable to load Week ${safeWeek} team performance. ${escapeHtml(error.message || String(error))}</div>`;
    if (performerContainer) {
      performerContainer.classList.remove('skeleton-block');
      performerContainer.innerHTML = `<div class="performers-empty"><strong>Unable to load Week ${safeWeek} awards.</strong><span>${escapeHtml(error.message || String(error))}</span></div>`;
    }
  }
}

async function changeAwardsWeek_(delta) {
  const max = Math.max(1, Number(state.league && state.league.currentWeek || 1));
  const next = Math.min(max, Math.max(1, Number(state.awardsWeek || 1) + Number(delta || 0)));
  if (next === Number(state.awardsWeek || 1)) return;
  await renderWeeklyAwards_(next);
}

function renderOverviewTopStats(week = state.selectedWeek) {
  const container = document.getElementById('overviewTopStats');
  const weekLabel = document.getElementById('performersWeekLabel');

  if (!container) return;
  if (weekLabel) weekLabel.textContent = `Week ${week}`;

  container.classList.add('skeleton-block');
  container.innerHTML = `
    <div class="performers-loading">
      <strong>Loading weekly player leaders...</strong>
      <span>ALL · QB · RB · WR · TE · FLEX · K · D/ST</span>
    </div>
  `;

  loadTopPerformers(Number(week));
}

async function getWeekPerformance_(week) {
  const key = Number(week);
  if (!Number.isInteger(key) || key < 1) throw new Error('Invalid awards week');
  const cached = state.weekPerformanceCache.get(key);
  if (cached && (cached.pending || cached.expiresAt > Date.now())) return cached.promise;
  const record = { pending: true, expiresAt: 0, promise: null };
  record.promise = api_('performance', { week: key }).then(data => {
    if (!data || data.ok === false || Number(data.scoringPeriodId) !== key ||
        data.source !== 'weekly-boxscore-v10' || !Array.isArray(data.teams) ||
        !Array.isArray(data.matchups)) {
      throw new Error('Weekly data is unavailable or outdated. Deploy the v10 API and retry.');
    }
    if (!data.complete || !data.teams.length) {
      throw new Error('ESPN has not returned all weekly starting lineups yet. Please retry shortly.');
    }
    record.pending = false;
    // Expire even historical results so ESPN stat corrections can be picked up.
    record.expiresAt = Date.now() + 30000;
    return data;
  }).catch(error => {
    if (state.weekPerformanceCache.get(key) === record) state.weekPerformanceCache.delete(key);
    throw error;
  });
  state.weekPerformanceCache.set(key, record);
  return record.promise;
}

function performanceSnapshots_(data) {
  const teamById = new Map((state.teams || []).map(team => [Number(team.id), team]));
  return data.teams.map(result => ({
    team: teamById.get(Number(result.teamId)) || { id: Number(result.teamId), name: 'Team ' + result.teamId },
    data: result,
    roster: Array.isArray(result.roster) ? result.roster : []
  }));
}

async function getWeekRosterSnapshots_(week) {
  return performanceSnapshots_(await getWeekPerformance_(week));
}

async function loadTopPerformers(week) {
  const container = document.getElementById('overviewTopStats');
  if (!container) return;

  const requestToken = ++state.performerRequestToken;

  try {
    if (!state.playerPerformanceCache.has(week)) {
      const rosterSnapshots = await getWeekRosterSnapshots_(week);
      const playerPool = [];

      rosterSnapshots.forEach(snapshot => {
        const { team, roster } = snapshot;

        roster.forEach(player => {
          // Weekly Top Performers is a STARTER leaderboard. Bench and IR
          // performances do not qualify for Player of the Week.
          if (player.isStarter !== true) return;

          const points = getWeeklyPlayerPoints(player, week);
          const position = normalizeFantasyPosition(player.position || player.lineupSlot);
          const lineupSlot = normalizeTopPerformerSlot_(player.lineupSlot || player.slot);

          if (!position || points == null) return;

          playerPool.push({
            playerId: Number(player.playerId || player.id || 0),
            name: player.name || 'Unknown Player',
            position,
            lineupSlot,
            points,
            nflTeam: getPlayerNflTeam(player),
            fantasyTeam: team.name,
            fantasyTeamId: Number(team.id)
          });
        });
      });

      state.playerPerformanceCache.set(week, playerPool);
    }

    if (requestToken !== state.performerRequestToken || Number(state.selectedWeek) !== Number(week)) return;

    const playerPool = state.playerPerformanceCache.get(week) || [];
    container.classList.remove('skeleton-block');

    if (!playerPool.length) {
      container.innerHTML = `
        <div class="performers-empty">
          <strong>Player scoring is waiting on the API.</strong>
          <span>The leaderboard will populate when ESPN returns weekly starter points.</span>
        </div>
      `;
      return;
    }

    renderTopPerformerLeaderboard_(container, week, playerPool);
  } catch (error) {
    if (requestToken !== state.performerRequestToken) return;

    container.classList.remove('skeleton-block');
    container.innerHTML = `
      <div class="performers-empty">
        <strong>Unable to load player leaders.</strong>
        <span>${escapeHtml(error.message || String(error))}</span>
      </div>
    `;
  }
}

function normalizeTopPerformerSlot_(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (['FLEX', 'RB/WR/TE', 'WR/RB/TE', 'OP'].includes(raw)) return 'FLEX';
  if (['D/ST', 'DST', 'DEF'].includes(raw)) return 'DST';
  return raw;
}

function topPerformerCandidates_(playerPool, category) {
  if (category === 'ALL') return playerPool.slice();
  if (category === 'FLEX') return playerPool.filter(player => player.lineupSlot === 'FLEX');
  return playerPool.filter(player => player.position === category);
}

function renderTopPerformerLeaderboard_(container, week, playerPool) {
  const categories = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'];
  let active = String(state.topPerformerPosition || 'ALL').toUpperCase();
  if (!categories.includes(active)) active = 'ALL';
  state.topPerformerPosition = active;

  const overallLeader = playerPool.slice().sort((a, b) => b.points - a.points)[0] || null;
  const leaders = topPerformerCandidates_(playerPool, active)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .slice(0, 5);

  const tabLabel = value => value === 'DST' ? 'D/ST' : value;

  container.innerHTML = `
    <div class="performer-tabs" role="tablist" aria-label="Top performer position">
      ${categories.map(category => `
        <button
          class="performer-tab ${category === active ? 'is-active' : ''}"
          type="button"
          role="tab"
          aria-selected="${category === active ? 'true' : 'false'}"
          data-performer-position="${category}"
        >${tabLabel(category)}</button>
      `).join('')}
    </div>

    <div class="performer-leaderboard-head">
      <span>${active === 'ALL' ? 'Top 5 Starters Overall' : `Top 5 ${tabLabel(active)}`}</span>
      <small>Week ${week} · starters only</small>
    </div>

    <div class="performer-leaderboard">
      ${leaders.length ? leaders.map((leader, index) => {
        const isPlayerOfWeek = overallLeader &&
          leader.name === overallLeader.name &&
          Number(leader.points) === Number(overallLeader.points);

        return `
          <div class="performer-row ${isPlayerOfWeek ? 'is-player-week' : ''}">
            <div class="performer-rank">#${index + 1}</div>
            <div class="performer-copy">
              <div class="performer-name-line">
                <strong>${escapeHtml(leader.name)}</strong>
                ${isPlayerOfWeek ? '<span class="player-week-badge">Player of Week</span>' : ''}
              </div>
              <span>${escapeHtml(leader.position === 'DST' ? 'D/ST' : leader.position)} · ${escapeHtml(leader.nflTeam)} · ${escapeHtml(leader.fantasyTeam)}</span>
            </div>
            <div class="performer-points">
              <strong>${number2(leader.points)}</strong>
              <small>PTS</small>
            </div>
          </div>
        `;
      }).join('') : `
        <div class="performers-empty compact">
          <strong>No qualifying ${escapeHtml(tabLabel(active))} starters.</strong>
          <span>Only players started in this category during Week ${week} are ranked.</span>
        </div>
      `}
    </div>
  `;

  container.querySelectorAll('[data-performer-position]').forEach(button => {
    button.addEventListener('click', () => {
      state.topPerformerPosition = String(button.dataset.performerPosition || 'ALL').toUpperCase();
      renderTopPerformerLeaderboard_(container, week, playerPool);
    });
  });
}

function getWeeklyPlayerPoints(player, week) {
  if (!player || typeof player !== 'object') return null;
  if (player.scoringPeriodId != null && Number(player.scoringPeriodId) !== Number(week)) return null;

  const directCandidates = [
    player.weekPoints,
    player.weeklyPoints,
    player.fantasyPoints,
    player.points,
    player.appliedStatTotal,
    player.score,
    player.actualPoints,
    player.scoringPeriodPoints
  ];

  for (const value of directCandidates) {
    const parsed = parseFiniteNumber(value);
    if (parsed != null) return parsed;
  }

  const weekKeys = [String(week), `week${week}`, `W${week}`];
  const containers = [
    player.pointsByWeek,
    player.weeklyScores,
    player.scoringPeriods,
    player.statsByWeek
  ];

  for (const source of containers) {
    if (!source || typeof source !== 'object') continue;

    for (const key of weekKeys) {
      const entry = source[key];
      if (entry == null) continue;

      if (typeof entry === 'number' || typeof entry === 'string') {
        const parsed = parseFiniteNumber(entry);
        if (parsed != null) return parsed;
      }

      if (typeof entry === 'object') {
        for (const nested of [
          entry.points,
          entry.fantasyPoints,
          entry.appliedStatTotal,
          entry.score
        ]) {
          const parsed = parseFiniteNumber(nested);
          if (parsed != null) return parsed;
        }
      }
    }
  }

  return null;
}

function parseFiniteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFantasyPosition(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  if (raw === 'D/ST' || raw === 'DEF' || raw === 'DST') return 'DST';
  if (raw === 'QB') return 'QB';
  if (raw === 'RB' || raw === 'HB' || raw === 'FB') return 'RB';
  if (raw === 'WR') return 'WR';
  if (raw === 'TE') return 'TE';
  if (raw === 'K' || raw === 'PK') return 'K';
  return '';
}

function getPlayerNflTeam(player) {
  const value =
    player.proTeamAbbrev ||
    player.proTeam ||
    player.nflTeam ||
    player.nflTeamAbbrev ||
    player.teamAbbrev ||
    player.team ||
    '';

  return String(value || 'NFL');
}

function renderFeaturedMatchup(matchups, week) {
  const container = document.getElementById('featuredMatchup');

  if (!matchups.length) {
    container.innerHTML = '<div class="error-panel">No matchup data is available for this week yet.</div>';
    return;
  }

  const featured = chooseFeaturedMatchup(matchups, week);
  const home = state.teamMap.get(Number(featured.homeTeamId));
  const away = state.teamMap.get(Number(featured.awayTeamId));
  const story = getMatchupStory(featured, week);

  document.getElementById('featuredStoryTitle').textContent =
    story.featured ? story.title : 'Game of the Week';

  document.getElementById('featuredStorySubtitle').textContent =
    story.featured ? story.eyebrow : story.tag;

  document.getElementById('featuredStoryReason').innerHTML = `
    <span>Why it matters</span>
    <p>${escapeHtml(story.reason)}</p>
  `;

  container.innerHTML = `
    ${featuredTeamMarkup(home, featured.homeScore, 'left')}
    <div class="vs-mark">VS</div>
    ${featuredTeamMarkup(away, featured.awayScore, 'right')}
  `;

  container.dataset.matchupKey = battleMatchupKey_(featured, week);
}

function chooseFeaturedMatchup(matchups, week) {
  if (!Array.isArray(matchups) || !matchups.length) {
    return null;
  }

  // Manual storyline always wins. This preserves special events such as
  // Week 1's championship rematch.
  const explicit = matchups.find(match =>
    getMatchupStory(match, week).featured
  );

  if (explicit) {
    console.log('[MatchOfWeek] Manual featured matchup selected', {
      week,
      homeTeamId: explicit.homeTeamId,
      awayTeamId: explicit.awayTeamId
    });

    return explicit;
  }

  /*
   * WEEK 2+ SMART MATCH OF THE WEEK
   *
   * Rank each matchup by how meaningful / entertaining it is:
   * - high-ranked teams
   * - close records
   * - same-conference implications
   * - playoff-position importance
   * - high-scoring teams
   * - close live/final score
   * - defending champion presence (bonus only, never automatic)
   */
  const ranked = matchups
    .map(match => ({
      match,
      ...scoreMatchOfWeek_(match, week)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      // Stable deterministic tiebreakers.
      if (b.combinedPoints !== a.combinedPoints) {
        return b.combinedPoints - a.combinedPoints;
      }

      return Number(a.match.matchupId || 0) -
        Number(b.match.matchupId || 0);
    });

  const winner = ranked[0];

  console.log('[MatchOfWeek] Auto featured matchup selected', {
    week,
    score: winner.score,
    reasons: winner.reasons,
    homeTeamId: winner.match.homeTeamId,
    awayTeamId: winner.match.awayTeamId,
    candidates: ranked.map(item => ({
      homeTeamId: item.match.homeTeamId,
      awayTeamId: item.match.awayTeamId,
      score: item.score,
      reasons: item.reasons
    }))
  });

  return winner.match;
}

function scoreMatchOfWeek_(match, week) {
  const home = state.teamMap.get(Number(match.homeTeamId));
  const away = state.teamMap.get(Number(match.awayTeamId));

  const homeStanding = getStandingForTeam_(match.homeTeamId);
  const awayStanding = getStandingForTeam_(match.awayTeamId);

  let score = 0;
  const reasons = [];

  const homeRank = safeRank_(homeStanding);
  const awayRank = safeRank_(awayStanding);

  const homeWins = Number(
    homeStanding && homeStanding.wins != null
      ? homeStanding.wins
      : home && home.wins || 0
  );

  const awayWins = Number(
    awayStanding && awayStanding.wins != null
      ? awayStanding.wins
      : away && away.wins || 0
  );

  const homeLosses = Number(
    homeStanding && homeStanding.losses != null
      ? homeStanding.losses
      : home && home.losses || 0
  );

  const awayLosses = Number(
    awayStanding && awayStanding.losses != null
      ? awayStanding.losses
      : away && away.losses || 0
  );

  const homePF = Number(
    homeStanding && homeStanding.pointsFor != null
      ? homeStanding.pointsFor
      : home && home.pointsFor || 0
  );

  const awayPF = Number(
    awayStanding && awayStanding.pointsFor != null
      ? awayStanding.pointsFor
      : away && away.pointsFor || 0
  );

  const sameConference =
    home &&
    away &&
    Number.isFinite(Number(home.divisionId)) &&
    Number(home.divisionId) === Number(away.divisionId);

  // 1) Top-team showdown.
  if (homeRank <= 4 && awayRank <= 4) {
    score += 34;
    reasons.push('Top 4 showdown');
  } else if (homeRank <= 6 && awayRank <= 6) {
    score += 22;
    reasons.push('Top-half matchup');
  } else if (homeRank <= 4 || awayRank <= 4) {
    score += 12;
    reasons.push('Top contender involved');
  }

  // 2) Close records create stronger stakes.
  const winDiff = Math.abs(homeWins - awayWins);
  const lossDiff = Math.abs(homeLosses - awayLosses);

  if (winDiff === 0 && lossDiff === 0) {
    score += 18;
    reasons.push('Identical records');
  } else if (winDiff <= 1 && lossDiff <= 1) {
    score += 12;
    reasons.push('Closely matched records');
  }

  // 3) Conference / division implications.
  if (sameConference) {
    score += 14;
    reasons.push('Conference race');
  }

  // 4) Playoff-position significance.
  const playoffSpots = Number(
    state.league && state.league.playoffTeams || 0
  );

  if (playoffSpots > 0) {
    const homeNearCut =
      homeRank <= playoffSpots + 2;
    const awayNearCut =
      awayRank <= playoffSpots + 2;

    if (homeNearCut && awayNearCut) {
      score += 18;
      reasons.push('Playoff-position battle');
    }
  }

  // 5) Reward strong offenses.
  const combinedPF = homePF + awayPF;

  if (combinedPF > 0) {
    const leaguePf = state.standings
      .map(row => Number(row.pointsFor || 0))
      .filter(value => value > 0);

    const avgPF = leaguePf.length
      ? leaguePf.reduce((sum, value) => sum + value, 0) / leaguePf.length
      : 0;

    if (avgPF > 0 && homePF >= avgPF && awayPF >= avgPF) {
      score += 14;
      reasons.push('Two high-scoring teams');
    } else if (avgPF > 0 && (homePF >= avgPF || awayPF >= avgPF)) {
      score += 7;
      reasons.push('High-scoring contender');
    }
  }

  // 6) During/after games, close contests and scoring explosions matter.
  const homeScore = Number(match.homeScore || 0);
  const awayScore = Number(match.awayScore || 0);
  const combinedPoints = homeScore + awayScore;
  const scoreDiff = Math.abs(homeScore - awayScore);

  if (combinedPoints > 0) {
    if (scoreDiff <= 5) {
      score += 20;
      reasons.push('Nail-biter');
    } else if (scoreDiff <= 12) {
      score += 10;
      reasons.push('Close game');
    }

    if (combinedPoints >= 250) {
      score += 14;
      reasons.push('High-scoring battle');
    } else if (combinedPoints >= 200) {
      score += 8;
      reasons.push('Strong scoring matchup');
    }
  }

  // 7) Defending champion gets a meaningful bonus, but never an automatic win.
  const championInvolved =
    Boolean(home && home.defendingChampion) ||
    Boolean(away && away.defendingChampion);

  if (championInvolved) {
    score += 7;
    reasons.push('Defending champion');
  }

  // 8) Later weeks should naturally prioritize meaningful contenders.
  if (Number(week) >= 8) {
    if (homeRank <= 8 && awayRank <= 8) {
      score += 10;
      reasons.push('Late-season playoff implications');
    }
  }

  if (Number(week) >= 12) {
    if (homeRank <= 6 && awayRank <= 6) {
      score += 12;
      reasons.push('Late-season contender showdown');
    }
  }

  return {
    score,
    reasons,
    combinedPoints
  };
}

function getStandingForTeam_(teamId) {
  return (state.standings || []).find(row =>
    Number(row.teamId) === Number(teamId)
  ) || null;
}

function safeRank_(standing) {
  const rank = Number(
    standing && standing.overallRank
  );

  return Number.isFinite(rank) && rank > 0
    ? rank
    : 999;
}

function featuredTeamMarkup(team, score, side) {
  if (!team) return '<div class="featured-team"><h3>Unknown Team</h3></div>';

  return `
    <div class="featured-team featured-team-${side}">
      <img class="featured-mascot ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="${escapeAttr(team.name)} mascot" ${teamIconFallbackAttr(team)}>
      <h3>${escapeHtml(team.name)}</h3>
      <p>${escapeHtml(ownerText(team))}</p>
      <div class="featured-score">${number2(score)}</div>
    </div>
  `;
}

function renderLeaguePulse(matchups = state.currentMatchups, week = state.selectedWeek, containerId = 'leaguePulse') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const games = Array.isArray(matchups) ? matchups : [];
  const scoredGames = games.filter(match =>
    Number(match.homeScore || 0) > 0 ||
    Number(match.awayScore || 0) > 0
  );

  const weekIsComplete = Number(state.league.latestScoringPeriod || 0) >= Number(week);
  const hasMeaningfulScores = scoredGames.length > 0;

  container.classList.remove('skeleton-block');

  if (!hasMeaningfulScores) {
    const scheduledCount = games.length;
    container.innerHTML = `
      <div class="weekly-spotlight-waiting">
        <div class="spotlight-wait-icon">🏈</div>
        <div>
          <strong>Week ${escapeHtml(String(week))} spotlight is waiting for kickoff.</strong>
          <span>${escapeHtml(String(scheduledCount))} matchups are scheduled. High score, biggest win, closest battle and the week's shootout will appear here as points come in.</span>
        </div>
      </div>
    `;
    return;
  }

  const teamScores = [];

  scoredGames.forEach(match => {
    const home = state.teamMap.get(Number(match.homeTeamId));
    const away = state.teamMap.get(Number(match.awayTeamId));

    if (home) {
      teamScores.push({
        team: home,
        score: Number(match.homeScore || 0),
        opponent: away,
        opponentScore: Number(match.awayScore || 0)
      });
    }

    if (away) {
      teamScores.push({
        team: away,
        score: Number(match.awayScore || 0),
        opponent: home,
        opponentScore: Number(match.homeScore || 0)
      });
    }
  });

  const highScore = teamScores.slice().sort((a, b) => b.score - a.score)[0];

  const decidedGames = scoredGames.filter(match =>
    Number(match.homeScore || 0) !== Number(match.awayScore || 0)
  );

  const biggestWinMatch = decidedGames.slice().sort((a, b) => {
    const marginA = Math.abs(Number(a.homeScore || 0) - Number(a.awayScore || 0));
    const marginB = Math.abs(Number(b.homeScore || 0) - Number(b.awayScore || 0));
    return marginB - marginA;
  })[0];

  const closestMatch = decidedGames.slice().sort((a, b) => {
    const marginA = Math.abs(Number(a.homeScore || 0) - Number(a.awayScore || 0));
    const marginB = Math.abs(Number(b.homeScore || 0) - Number(b.awayScore || 0));
    return marginA - marginB;
  })[0];

  const shootoutMatch = scoredGames.slice().sort((a, b) =>
    (Number(b.homeScore || 0) + Number(b.awayScore || 0)) -
    (Number(a.homeScore || 0) + Number(a.awayScore || 0))
  )[0];

  const items = [];

  if (highScore) {
    items.push({
      icon: '🏆',
      label: weekIsComplete ? 'Team of the Week' : 'High Score Right Now',
      title: highScore.team.name,
      detail: `${number2(highScore.score)} points${highScore.opponent ? ` vs ${highScore.opponent.name}` : ''}.`
    });
  }

  if (biggestWinMatch) {
    const homeScore = Number(biggestWinMatch.homeScore || 0);
    const awayScore = Number(biggestWinMatch.awayScore || 0);
    const winnerId = homeScore > awayScore ? biggestWinMatch.homeTeamId : biggestWinMatch.awayTeamId;
    const winner = state.teamMap.get(Number(winnerId));
    const margin = Math.abs(homeScore - awayScore);

    items.push({
      icon: '🔥',
      label: 'Biggest Win',
      title: winner ? winner.name : 'Weekly leader',
      detail: `${number2(margin)}-point margin.`
    });
  }

  if (closestMatch) {
    const home = state.teamMap.get(Number(closestMatch.homeTeamId));
    const away = state.teamMap.get(Number(closestMatch.awayTeamId));
    const margin = Math.abs(Number(closestMatch.homeScore || 0) - Number(closestMatch.awayScore || 0));

    items.push({
      icon: '⚡',
      label: 'Closest Battle',
      title: `${home ? home.name : 'Home'} vs ${away ? away.name : 'Away'}`,
      detail: `${number2(margin)} points separate them.`
    });
  }

  if (shootoutMatch) {
    const home = state.teamMap.get(Number(shootoutMatch.homeTeamId));
    const away = state.teamMap.get(Number(shootoutMatch.awayTeamId));
    const total = Number(shootoutMatch.homeScore || 0) + Number(shootoutMatch.awayScore || 0);

    items.push({
      icon: '💥',
      label: 'Weekly Shootout',
      title: `${home ? home.name : 'Home'} vs ${away ? away.name : 'Away'}`,
      detail: `${number2(total)} combined points.`
    });
  }

  container.innerHTML = items.slice(0, 4).map(item => `
    <div class="pulse-item weekly-spotlight-item">
      <div class="weekly-spotlight-icon">${item.icon}</div>
      <div class="weekly-spotlight-copy">
        <small>${escapeHtml(item.label)}</small>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.detail)}</span>
      </div>
    </div>
  `).join('');
}



function renderGradesWeekTabs_() {
  const container = document.getElementById('gradesWeekTabs');
  if (!container) return;

  const currentWeek = Math.max(1, Number(state.league && state.league.currentWeek || 1));
  const selected = Math.min(currentWeek, Math.max(1, Number(state.gradesWeek || currentWeek)));
  state.gradesWeek = selected;

  container.innerHTML = Array.from({ length: currentWeek }, (_, index) => {
    const week = index + 1;
    return `<button type="button" class="grades-week-tab ${week === selected ? 'is-active' : ''}" data-grades-week="${week}" aria-pressed="${week === selected ? 'true' : 'false'}">Week ${week}</button>`;
  }).join('');
}

async function changeGradesWeek_(week, force = false) {
  const currentWeek = Math.max(1, Number(state.league && state.league.currentWeek || 1));
  const targetWeek = Math.min(currentWeek, Math.max(1, Number(week || currentWeek)));
  if (!force && targetWeek === Number(state.gradesWeek || 0)) return;

  state.gradesWeek = targetWeek;
  renderGradesWeekTabs_();

  const label = document.getElementById('teamGradesWeekLabel');
  if (label) label.textContent = `Week ${targetWeek}`;

  const container = document.getElementById('weeklyTeamGrades');
  if (container) {
    container.classList.add('skeleton-block');
    container.innerHTML = `<div class="team-grades-loading"><strong>Loading Week ${targetWeek} grades...</strong><span>Retrieving the saved matchup and starter results.</span></div>`;
  }

  try {
    const matchups = await getWeekMatchups(targetWeek);
    if (Number(state.gradesWeek) !== targetWeek) return;
    await renderWeeklyTeamGrades(matchups, targetWeek);
  } catch (error) {
    if (Number(state.gradesWeek) !== targetWeek || !container) return;
    container.classList.remove('skeleton-block');
    container.innerHTML = `<div class="team-grades-loading is-error"><strong>Unable to load Week ${targetWeek} grades.</strong><span>${escapeHtml(error.message || String(error))}</span></div>`;
  }
}

async function renderWeeklyTeamGrades(matchups = state.currentMatchups, week = state.selectedWeek) {
  const container = document.getElementById('weeklyTeamGrades');
  const weekLabel = document.getElementById('teamGradesWeekLabel');
  if (!container) return;

  const requestToken = ++state.teamGradeRequestToken;
  const safeWeek = Number(week || 1);
  state.gradesWeek = safeWeek;
  renderGradesWeekTabs_();
  if (weekLabel) weekLabel.textContent = `Week ${safeWeek}`;

  container.classList.add('skeleton-block');
  container.innerHTML = `
    <div class="team-grades-loading">
      <strong>Building Week ${escapeHtml(String(safeWeek))} report cards...</strong>
      <span>Score vs projection · league rank · matchup result · lineup efficiency</span>
    </div>
  `;

  try {
    const rosterSnapshots = await getWeekRosterSnapshots_(safeWeek);
    if (requestToken !== state.teamGradeRequestToken || Number(state.gradesWeek) !== safeWeek) return;

    const rosterByTeam = new Map(
      rosterSnapshots.map(snapshot => [Number(snapshot.team.id), snapshot])
    );

    const games = Array.isArray(matchups) ? matchups : [];
    const allScores = [];

    games.forEach(match => {
      allScores.push({ teamId: Number(match.homeTeamId), score: Number(match.homeScore || 0) });
      allScores.push({ teamId: Number(match.awayTeamId), score: Number(match.awayScore || 0) });
    });

    const rankedScores = allScores
      .slice()
      .sort((a, b) => b.score - a.score || a.teamId - b.teamId);

    const weeklyRank = new Map();
    rankedScores.forEach((row, index) => weeklyRank.set(row.teamId, index + 1));

    const reports = [];
    let completeCount = 0;

    games.forEach(match => {
      const homeId = Number(match.homeTeamId);
      const awayId = Number(match.awayTeamId);
      const homeSnapshot = rosterByTeam.get(homeId);
      const awaySnapshot = rosterByTeam.get(awayId);
      const starterSummary = homeSnapshot && awaySnapshot
        ? battleStarterStatusSummary_(homeSnapshot.roster, awaySnapshot.roster)
        : { complete: String(match.status || '').toUpperCase() === 'COMPLETED' };

      const isComplete = Boolean(starterSummary.complete) || ['COMPLETED', 'FINAL', 'POST'].includes(String(match.status || '').toUpperCase());
      if (isComplete) completeCount += 1;

      reports.push(buildTeamGradeReport_(match, 'home', homeSnapshot, awaySnapshot, isComplete, weeklyRank, allScores.length));
      reports.push(buildTeamGradeReport_(match, 'away', awaySnapshot, homeSnapshot, isComplete, weeklyRank, allScores.length));
    });

    const weekComplete = games.length > 0 && completeCount === games.length;

    reports.sort((a, b) => {
      if (a.pending !== b.pending) return a.pending ? 1 : -1;
      if (!a.pending && !b.pending && b.gradeScore !== a.gradeScore) return b.gradeScore - a.gradeScore;
      return a.rank - b.rank;
    });

    container.classList.remove('skeleton-block');
    container.innerHTML = `
      <div class="team-grades-note ${weekComplete ? 'is-locked' : 'is-live'}">
        <span>${weekComplete ? '✓ FINAL WEEKLY GRADES' : '● PROVISIONAL GRADES'}</span>
        <p>${weekComplete
          ? `Week ${safeWeek} is complete. Grades are locked from the final matchup results.`
          : `Grades lock after every Week ${safeWeek} matchup is completed. Teams still playing remain pending.`}</p>
      </div>
      <div class="team-grades-grid">
        ${reports.map(report => teamGradeCard_(report, weekComplete)).join('')}
      </div>
    `;
  } catch (error) {
    if (requestToken !== state.teamGradeRequestToken) return;
    container.classList.remove('skeleton-block');
    container.innerHTML = `
      <div class="team-grades-loading is-error">
        <strong>Unable to build weekly grades.</strong>
        <span>${escapeHtml(error.message || String(error))}</span>
      </div>
    `;
  }
}

function buildTeamGradeReport_(match, side, snapshot, opponentSnapshot, isComplete, weeklyRank, teamCount) {
  const isHome = side === 'home';
  const teamId = Number(isHome ? match.homeTeamId : match.awayTeamId);
  const opponentId = Number(isHome ? match.awayTeamId : match.homeTeamId);
  const team = state.teamMap.get(teamId) || (snapshot && snapshot.team) || null;
  const opponent = state.teamMap.get(opponentId) || (opponentSnapshot && opponentSnapshot.team) || null;
  const score = Number(isHome ? match.homeScore || 0 : match.awayScore || 0);
  const opponentScore = Number(isHome ? match.awayScore || 0 : match.homeScore || 0);
  const rank = Number(weeklyRank.get(teamId) || teamCount || 12);
  const roster = snapshot && Array.isArray(snapshot.roster) ? snapshot.roster : [];
  const lineup = normalizeBattleLineup_(roster);
  const starters = lineup.starters.filter(Boolean);
  const projection = rosterProjectionTotal_(starters);
  const optimal = calculateOptimalLineupScore_(roster);
  const efficiency = optimal > 0 ? Math.min(100, (score / optimal) * 100) : 100;
  const ratio = projection > 0 ? score / projection : 1;
  const margin = Math.abs(score - opponentScore);
  const result = score > opponentScore ? 'W' : score < opponentScore ? 'L' : 'T';

  if (!isComplete) {
    return {
      pending: true,
      teamId,
      team,
      opponent,
      score,
      projection,
      ratio,
      rank,
      result,
      margin,
      efficiency,
      grade: '—',
      gradeScore: -1,
      reason: 'Matchup still in progress or waiting for kickoff.'
    };
  }

  const projectionComponent = clampGrade_(75 + ((ratio - 1) * 125), 0, 100);
  const rankComponent = teamCount > 1
    ? clampGrade_(100 - (((rank - 1) / (teamCount - 1)) * 100), 0, 100)
    : 100;

  let resultComponent = 62;
  if (result === 'W') resultComponent = clampGrade_(78 + (margin * 0.55), 78, 100);
  if (result === 'L') resultComponent = clampGrade_(62 - (margin * 0.30), 45, 62);

  const efficiencyComponent = clampGrade_(efficiency, 0, 100);
  const gradeScore =
    (projectionComponent * 0.45) +
    (rankComponent * 0.30) +
    (resultComponent * 0.15) +
    (efficiencyComponent * 0.10);

  const grade = gradeLetter_(gradeScore);
  const reason = buildGradeReason_({
    score,
    projection,
    ratio,
    rank,
    result,
    margin,
    efficiency,
    opponent
  });

  return {
    pending: false,
    teamId,
    team,
    opponent,
    score,
    projection,
    ratio,
    rank,
    result,
    margin,
    efficiency,
    grade,
    gradeScore,
    reason
  };
}

function calculateOptimalLineupScore_(roster) {
  const players = (Array.isArray(roster) ? roster : [])
    .filter(player => !isBattleIrPlayer_(player))
    .map(player => ({
      player,
      position: normalizeFantasyPosition(player.position || player.lineupSlot),
      points: battlePlayerActualPoints_(player) || 0
    }));

  const pickTop = (position, count) => players
    .filter(item => item.position === position)
    .sort((a, b) => b.points - a.points)
    .slice(0, count);

  const selected = [];
  const fixedGroups = [
    ['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1], ['K', 1], ['DST', 1]
  ];

  fixedGroups.forEach(([position, count]) => {
    pickTop(position, count).forEach(item => selected.push(item));
  });

  const selectedPlayers = new Set(selected.map(item => item.player));
  const flex = players
    .filter(item => ['RB', 'WR', 'TE'].includes(item.position) && !selectedPlayers.has(item.player))
    .sort((a, b) => b.points - a.points)
    .slice(0, 2);

  selected.push(...flex);
  return selected.reduce((sum, item) => sum + Number(item.points || 0), 0);
}

function clampGrade_(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function gradeLetter_(score) {
  const value = Number(score || 0);
  if (value >= 95) return 'A+';
  if (value >= 90) return 'A';
  if (value >= 87) return 'A-';
  if (value >= 84) return 'B+';
  if (value >= 80) return 'B';
  if (value >= 76) return 'B-';
  if (value >= 72) return 'C+';
  if (value >= 68) return 'C';
  if (value >= 64) return 'C-';
  if (value >= 60) return 'D+';
  if (value >= 55) return 'D';
  if (value >= 50) return 'D-';
  return 'F';
}

function buildGradeReason_(report) {
  const pieces = [];
  const pct = (report.ratio - 1) * 100;

  if (pct >= 20) pieces.push(`Crushed projection by ${Math.abs(pct).toFixed(0)}%`);
  else if (pct >= 5) pieces.push(`Beat projection by ${Math.abs(pct).toFixed(0)}%`);
  else if (pct <= -20) pieces.push(`Finished ${Math.abs(pct).toFixed(0)}% below projection`);
  else if (pct <= -5) pieces.push(`Missed projection by ${Math.abs(pct).toFixed(0)}%`);
  else pieces.push('Finished close to projection');

  if (report.rank <= 3) pieces.push(`#${report.rank} scoring team`);
  else if (report.rank >= 10) pieces.push(`#${report.rank} in weekly scoring`);

  if (report.result === 'W') pieces.push(`won by ${number2(report.margin)}`);
  if (report.result === 'L') pieces.push(`lost by ${number2(report.margin)}`);

  if (report.efficiency >= 95) pieces.push('excellent lineup efficiency');
  else if (report.efficiency < 80) pieces.push('left meaningful points on the bench');

  return pieces.slice(0, 3).join(' · ') + '.';
}

function teamGradeCard_(report, weekComplete) {
  const team = report.team;
  const icon = team ? getTeamIcon(team) : '';
  const projectionDelta = report.projection > 0 ? ((report.score / report.projection) - 1) * 100 : 0;
  const resultText = report.result === 'W'
    ? `WIN +${number2(report.margin)}`
    : report.result === 'L'
      ? `LOSS -${number2(report.margin)}`
      : 'TIE';

  return `
    <article class="team-grade-card ${report.pending ? 'is-pending' : `grade-${String(report.grade).replace('+', 'plus').replace('-', 'minus')}`}" data-team-grade="${escapeAttr(String(report.teamId))}">
      <div class="team-grade-top">
        <div class="team-grade-team">
          ${team ? `<img class="${teamIconClass(team)}" src="${escapeAttr(icon)}" alt="" ${teamIconFallbackAttr(team)}>` : ''}
          <div>
            <strong>${escapeHtml(team ? team.name : 'Unknown Team')}</strong>
            <span>${escapeHtml(team ? ownerText(team) : '')}</span>
          </div>
        </div>
        <div class="team-grade-letter">${escapeHtml(report.grade)}</div>
      </div>

      <div class="team-grade-metrics">
        <div><small>SCORE</small><strong>${number2(report.score)}</strong></div>
        <div><small>VS PROJ</small><strong class="${projectionDelta >= 0 ? 'is-positive' : 'is-negative'}">${report.projection > 0 ? `${projectionDelta >= 0 ? '+' : ''}${projectionDelta.toFixed(0)}%` : '—'}</strong></div>
        <div><small>RESULT</small><strong>${report.pending ? 'PENDING' : resultText}</strong></div>
        <div><small>${weekComplete ? 'WEEK RANK' : 'CURRENT RANK'}</small><strong>#${escapeHtml(String(report.rank))}</strong></div>
      </div>

      <div class="team-grade-efficiency">
        <div><span>Lineup efficiency</span><strong>${report.pending ? '—' : `${report.efficiency.toFixed(0)}%`}</strong></div>
        <div class="team-grade-bar"><i style="width:${report.pending ? 0 : Math.min(100, report.efficiency).toFixed(0)}%"></i></div>
      </div>

      <p class="team-grade-reason">${escapeHtml(report.reason)}</p>
    </article>
  `;
}

async function changeWeek(delta) {
  const min = 1;
  const max = Number(state.league.regularSeasonWeeks || 14);
  const next = Math.min(max, Math.max(min, state.selectedWeek + delta));

  if (next === state.selectedWeek) return;

  const audit = FantasyPerf.start('changeWeek', {
    fromWeek: state.selectedWeek,
    toWeek: next
  });

  setWeekLoading(next);

  try {
    const matchups = await getWeekMatchups(next);
    renderWeek(matchups, next);

    audit.end({
      success: true,
      matchups: matchups.length,
      cacheHit: state.weekCache.has(Number(next))
    });
  } catch (error) {
    renderWeekError(error, next);
    audit.fail(error, { success: false });
  }
}

async function getWeekMatchups(week) {
  const targetWeek = Number(week);
  const currentWeek = Number(state.league && state.league.currentWeek || state.selectedWeek || 1);

  if (targetWeek !== currentWeek && state.weekCache.has(targetWeek)) {
    return state.weekCache.get(targetWeek);
  }

  const data = await api_('matchups', { week: targetWeek });
  const matchups = Array.isArray(data.matchups) ? data.matchups : [];
  state.weekCache.set(targetWeek, matchups);

  if (targetWeek === currentWeek) {
    state.currentMatchups = matchups;
  }

  return matchups;
}

async function refreshCurrentWeekMatchups_(render = true) {
  const currentWeek = Number(state.league && state.league.currentWeek || state.selectedWeek || 1);

  try {
    const data = await api_('matchups', { week: currentWeek });
    const matchups = Array.isArray(data.matchups) ? data.matchups : [];

    state.lastScoreRefreshAt = Date.now();
    state.lastSyncAt = Date.now();

    if (matchups.length) {
      state.currentMatchups = matchups;
      state.matchupsResolved = true;
      state.weekCache.set(currentWeek, matchups);
      saveMatchupsBrowserCache_(currentWeek, matchups);

      if (state.scoresStale || state.leagueDegraded === false) {
        setApiStatus(true, 'ESPN Connected');
      }
      state.scoresStale = false;

      if (render && Number(state.selectedWeek) === currentWeek) {
        renderWeek(matchups, currentWeek);
      }
    }

    return matchups;
  } catch (error) {
    console.warn('Current-week score refresh failed:', error);

    // Keep showing the last known scores, but say so.
    state.scoresStale = true;
    setApiStatus(false, 'Scores delayed · retrying');

    return state.currentMatchups || [];
  }
}

function setWeekLoading(week) {
  syncWeekLabels(week);
  document.getElementById('overviewMatchups').innerHTML = '<div class="skeleton-block"></div>';
  document.getElementById('battleGrid').innerHTML = '<div class="skeleton-block"></div>';
  document.getElementById('battleFeatured').innerHTML = '<div class="arena-loading skeleton-block"></div>';
}

function renderWeekError(error, week) {
  const message = escapeHtml(error.message || String(error));
  document.getElementById('overviewMatchups').innerHTML = `<div class="error-panel">${message}</div>`;
  document.getElementById('battleGrid').innerHTML = `<div class="error-panel">${message}</div>`;
  document.getElementById('battleFeatured').innerHTML = `<div class="error-panel">${message}</div>`;
  syncWeekLabels(week);
}

function renderOverviewMatchups(matchups, week) {
  const grid = document.getElementById('overviewMatchups');

  if (!grid) return;

  if (!matchups.length) {
    grid.innerHTML = '<div class="error-panel">No matchups returned for this week.</div>';
    return;
  }

  grid.innerHTML = matchups.map(match => {
    const home = state.teamMap.get(Number(match.homeTeamId));
    const away = state.teamMap.get(Number(match.awayTeamId));
    const story = getMatchupStory(match, week);
    const featured = story.featured ? 'is-highlight' : '';

    return `
      <article
        class="overview-matchup-card ${featured}"
        data-matchup-key="${escapeAttr(battleMatchupKey_(match, week))}"
        role="button"
        tabindex="0"
        aria-label="Open FantasyCast for ${escapeAttr(home ? home.name : 'Home')} versus ${escapeAttr(away ? away.name : 'Away')}"
      >
        <div class="overview-matchup-teams">
          ${overviewMatchupTeamMarkup(home, match.homeScore, 'home')}
          <div class="overview-versus">VS</div>
          ${overviewMatchupTeamMarkup(away, match.awayScore, 'away')}
        </div>
        <div class="overview-matchup-footer">
          <span>${escapeHtml(story.tag)}</span>
          <span>${escapeHtml(match.status || 'Scheduled')}</span>
        </div>
      </article>
    `;
  }).join('');

  bindOverviewFantasyCastCards_(grid);
}

function overviewMatchupTeamMarkup(team, score, side) {
  return `
    <div class="overview-matchup-team overview-matchup-${side}">
      <img class="matchup-mascot ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="" ${teamIconFallbackAttr(team)}>
      <div class="overview-team-text">
        <div class="matchup-team-name">${escapeHtml(team ? team.name : 'Unknown Team')}</div>
        <div class="matchup-owner">${escapeHtml(team ? ownerText(team) : '')}</div>
      </div>
      <div class="matchup-score">${number2(score)}</div>
    </div>
  `;
}

function matchupRowMarkup(team, score) {
  return `
    <div class="matchup-row">
      <img class="matchup-mascot ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="" ${teamIconFallbackAttr(team)}>
      <div>
        <div class="matchup-team-name">${escapeHtml(team ? team.name : 'Unknown Team')}</div>
        <div class="matchup-owner">${escapeHtml(team ? ownerText(team) : '')}</div>
      </div>
      <div class="matchup-score">${number2(score)}</div>
    </div>
  `;
}

function renderBattleCenter(matchups, week) {
  const featuredContainer = document.getElementById('battleFeatured');
  const grid = document.getElementById('battleGrid');

  document.getElementById('battleCount').textContent =
    `${matchups.length} ${matchups.length === 1 ? 'battle' : 'battles'}`;

  if (!matchups.length) {
    featuredContainer.innerHTML = '<div class="error-panel">No battle card is available for this week.</div>';
    grid.innerHTML = '';
    const cast = document.getElementById('battleFantasyCast');
    if (cast) cast.innerHTML = '';
    return;
  }

  const featured = chooseFeaturedMatchup(matchups, week);
  const validKeys = new Set(matchups.map(match => battleMatchupKey_(match, week)));
  const featuredKey = battleMatchupKey_(featured, week);

  // New week or stale selection: start with Match of the Week open.
  if (!state.battleCastSelectedKey || !validKeys.has(state.battleCastSelectedKey)) {
    // Followers land on their own matchup; everyone else on Match of the Week.
    state.battleCastSelectedKey = myMatchupKeyIn_(matchups, week) || featuredKey;
    state.battleCastOpen = true;
  }

  const others = matchups.filter(match => match !== featured);
  const featuredStory = getMatchupStory(featured, week);

  featuredContainer.innerHTML = battleFeaturedMarkup(featured, featuredStory, week);

  const featuredStage = featuredContainer.querySelector('.motw-stage');
  if (featuredStage) {
    featuredStage.dataset.matchupKey = featuredKey;
    featuredStage.setAttribute('role', 'button');
    featuredStage.setAttribute('tabindex', '0');
    featuredStage.classList.toggle(
      'is-cast-selected',
      state.battleCastOpen && state.battleCastSelectedKey === featuredKey
    );
  }

  grid.innerHTML = others.map((match, index) =>
    battleCardMarkup(match, getMatchupStory(match, week), index)
  ).join('');

  bindBattleFantasyCastCards_(featuredContainer, grid);
  updateBattleCastSelectionUi_();

  requestAnimationFrame(() => {
    animateBattleEntrance();

    if (state.activeView === 'battle') {
      window.setTimeout(() => {
        startBattleFightLoop_();

        if (state.battleCastOpen) {
          loadBattleFantasyCast_();
        } else {
          hideBattleFantasyCast_(false);
        }
      }, 850);
    }
  });
}
function battleFeaturedMarkup(match, story, week) {
  const home = state.teamMap.get(Number(match.homeTeamId));
  const away = state.teamMap.get(Number(match.awayTeamId));

  return `
    <div class="motw-stage">
      <div class="motw-topline">
        <span class="motw-label">MATCH OF THE WEEK</span>
        <span class="motw-week">WEEK ${week}</span>
      </div>

      <div class="motw-story">
        <span>${escapeHtml(story.eyebrow)}</span>
        <h2>${escapeHtml(story.title)}</h2>
        <p>${escapeHtml(story.reason)}</p>
      </div>

      <div class="motw-fight">
        ${battleFighterMarkup(home, match.homeScore, 'left')}
        <div class="battle-impact" aria-hidden="true">
          <span class="impact-ring"></span>
          <strong>VS</strong>
          <small>${escapeHtml(story.tag)}</small>
        </div>
        ${battleFighterMarkup(away, match.awayScore, 'right')}
      </div>
    </div>
  `;
}

function battleCardMarkup(match, story, index) {
  const home = state.teamMap.get(Number(match.homeTeamId));
  const away = state.teamMap.get(Number(match.awayTeamId));

  return `
    <article
      class="battle-card"
      style="--battle-delay:${index * 90}ms"
      data-matchup-key="${escapeAttr(battleMatchupKey_(match, match.week || state.selectedWeek))}"
      role="button"
      tabindex="0"
      aria-label="Open FantasyCast for ${escapeAttr(home ? home.name : 'Home')} versus ${escapeAttr(away ? away.name : 'Away')}"
    >
      <div class="battle-card-tag">${escapeHtml(story.tag)}</div>

      <div class="battle-card-fighters">
        ${battleMiniFighterMarkup(home, match.homeScore, 'left')}
        <div class="battle-mini-vs">VS</div>
        ${battleMiniFighterMarkup(away, match.awayScore, 'right')}
      </div>

      <div class="battle-card-story">
        <strong>${escapeHtml(story.title)}</strong>
        <span>${escapeHtml(story.reason)}</span>
      </div>

      <div class="battle-status">
        <span>Week ${match.week || state.selectedWeek}</span>
        <span>${escapeHtml(match.status || 'Scheduled')}</span>
      </div>

      <div class="battle-cast-hint">
        <span>View FantasyCast</span>
        <strong>+</strong>
      </div>
    </article>
  `;
}

function battleFighterMarkup(team, score, side) {
  if (!team) return '<div class="battle-fighter"></div>';

  return `
    <div class="battle-fighter battle-fighter-${side} ${team.defendingChampion ? 'is-champion' : ''}">
      <div class="fighter-aura"></div>
      <img class="battle-mascot ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="${escapeAttr(team.name)} mascot" ${teamIconFallbackAttr(team)}>
      ${team.defendingChampion ? '<span class="fighter-champion">DEFENDING CHAMPION</span>' : ''}
      <h3>${escapeHtml(team.name)}</h3>
      <p>${escapeHtml(ownerText(team))}</p>
      <div class="fighter-score">${number2(score)}</div>
    </div>
  `;
}

function battleMiniFighterMarkup(team, score, side) {
  if (!team) return '<div class="battle-mini-team"></div>';

  return `
    <div class="battle-mini-team battle-mini-${side}">
      <img class="battle-mini-mascot ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="${escapeAttr(team.name)} mascot" ${teamIconFallbackAttr(team)}>
      <strong>${escapeHtml(team.name)}</strong>
      <span>${number2(score)}</span>
    </div>
  `;
}



function battleMatchupKey_(match, week) {
  if (!match) return '';
  return `${Number(week || match.week || state.selectedWeek || 1)}:${Number(match.homeTeamId || 0)}-${Number(match.awayTeamId || 0)}`;
}

function getBattleMatchupByKey_(key) {
  const week = Number(state.selectedWeek || 1);
  const matchups = state.weekCache.get(week) || state.currentMatchups || [];
  return matchups.find(match => battleMatchupKey_(match, week) === String(key || '')) || null;
}

function bindBattleFantasyCastCards_(featuredContainer, grid) {
  const clickable = [
    ...(featuredContainer ? featuredContainer.querySelectorAll('[data-matchup-key]') : []),
    ...(grid ? grid.querySelectorAll('[data-matchup-key]') : [])
  ];

  clickable.forEach(element => {
    const activate = () => toggleBattleFantasyCast_(element.dataset.matchupKey);

    element.addEventListener('click', event => {
      if (event.target.closest('button, a')) return;
      activate();
    });

    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  });
}

function bindOverviewFantasyCastCards_(grid) {
  if (!grid) return;

  grid.querySelectorAll('[data-matchup-key]').forEach(card => {
    const activate = () => openBattleCastFromMatchup_(card.dataset.matchupKey);

    card.addEventListener('click', activate);
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  });
}

function openBattleCastFromMatchup_(key) {
  if (!getBattleMatchupByKey_(key)) return;

  state.battleCastSelectedKey = key;
  state.battleCastOpen = true;

  switchView('battle');

  window.setTimeout(() => {
    updateBattleCastSelectionUi_();
    loadBattleFantasyCast_(true);
    scrollBattleFantasyCastIntoView_();
  }, 120);
}

function toggleBattleFantasyCast_(key) {
  if (!key || !getBattleMatchupByKey_(key)) return;

  const sameMatchup = state.battleCastSelectedKey === key;

  if (sameMatchup && state.battleCastOpen) {
    hideBattleFantasyCast_();
    return;
  }

  state.battleCastSelectedKey = key;
  state.battleCastOpen = true;

  updateBattleCastSelectionUi_();
  loadBattleFantasyCast_(true);

  window.setTimeout(scrollBattleFantasyCastIntoView_, 80);
}

function hideBattleFantasyCast_(scroll = false) {
  state.battleCastOpen = false;
  state.battleCastRequestSeq += 1;
  stopBattleFantasyCastPolling_();

  const container = document.getElementById('battleFantasyCast');
  if (container) {
    container.classList.remove('is-open');
    container.innerHTML = '';
  }

  updateBattleCastSelectionUi_();

  if (scroll) {
    const grid = document.getElementById('battleGrid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateBattleCastSelectionUi_() {
  const selectedKey = state.battleCastOpen ? state.battleCastSelectedKey : '';

  document.querySelectorAll('#battleFeatured [data-matchup-key], #battleGrid [data-matchup-key]').forEach(element => {
    const selected = element.dataset.matchupKey === selectedKey;
    element.classList.toggle('is-cast-selected', selected);

    const hint = element.querySelector('.battle-cast-hint');
    if (hint) {
      const label = hint.querySelector('span');
      const icon = hint.querySelector('strong');
      if (label) label.textContent = selected ? 'Hide FantasyCast' : 'View FantasyCast';
      if (icon) icon.textContent = selected ? '−' : '+';
    }
  });
}

function scrollBattleFantasyCastIntoView_() {
  const container = document.getElementById('battleFantasyCast');
  if (!container || !container.innerHTML.trim()) return;

  container.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

const BATTLE_CAST_REFRESH_MS = 60000;
const BATTLE_STARTER_SLOT_ORDER = Object.freeze([
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'D/ST', 'K'
]);

async function loadBattleFantasyCast_(force = false) {
  if (state.activeView !== 'battle' || state.battleCastLoading || !state.battleCastOpen) return;

  const week = Number(state.selectedWeek || 1);
  const currentWeek = Number(state.league && state.league.currentWeek || 1);
  const matchups = state.weekCache.get(week) || state.currentMatchups || [];
  if (!matchups.length) {
    stopBattleFantasyCastPolling_();
    return;
  }

  // The roster API represents the current lineup. Keep FantasyCast on current week.
  if (week !== currentWeek) {
    const container = document.getElementById('battleFantasyCast');
    if (container && state.battleCastOpen) {
      container.innerHTML = `
        <div class="fantasycast-unavailable">
          <strong>FantasyCast is available for the current week.</strong>
          <span>Return to Week ${currentWeek} to view the live ESPN lineup.</span>
          <button type="button" data-fantasycast-close>Hide</button>
        </div>
      `;
      const close = container.querySelector('[data-fantasycast-close]');
      if (close) close.addEventListener('click', () => hideBattleFantasyCast_());
    }
    stopBattleFantasyCastPolling_();
    return;
  }

  let selected = getBattleMatchupByKey_(state.battleCastSelectedKey);

  if (!selected) {
    selected = chooseFeaturedMatchup(matchups, week);
    state.battleCastSelectedKey = battleMatchupKey_(selected, week);
  }

  if (!selected) return;

  const selectionKey = battleMatchupKey_(selected, week);
  const homeId = Number(selected.homeTeamId);
  const awayId = Number(selected.awayTeamId);
  const cacheKey = `${week}:${homeId}-${awayId}`;
  const cached = state.battleCastCache.get(cacheKey);

  if (!force && cached && (Date.now() - cached.savedAt) < 15000) {
    if (state.battleCastOpen && state.battleCastSelectedKey === selectionKey) {
      renderBattleFantasyCast_(selected, cached.homeRoster, cached.awayRoster, week, cached.homeData, cached.awayData);
    }

    if (shouldShowFantasyCast_(selected, cached.homeRoster, cached.awayRoster)) {
      startBattleFantasyCastPolling_();
    } else {
      stopBattleFantasyCastPolling_();
    }
    return;
  }

  state.battleCastLoading = true;
  const requestSeq = ++state.battleCastRequestSeq;

  const container = document.getElementById('battleFantasyCast');
  const keepPanel = Boolean(force && container && container.querySelector('.fantasycast-shell'));
  if (container && state.battleCastOpen && !keepPanel) {
    container.classList.add('is-open');
    container.innerHTML = `
      <div class="fantasycast-loading">
        <span class="fantasycast-live-dot"></span>
        <strong>Loading FantasyCast...</strong>
        <small>Syncing both ESPN rosters</small>
      </div>
    `;
  }

  try {
    const [homeData, awayData] = await Promise.all([
      api_('roster', { teamId: homeId }),
      api_('roster', { teamId: awayId })
    ]);

    // User may have clicked another matchup while these requests were loading.
    if (
      requestSeq !== state.battleCastRequestSeq ||
      !state.battleCastOpen ||
      state.battleCastSelectedKey !== selectionKey
    ) {
      return;
    }

    const homeRoster = Array.isArray(homeData && homeData.roster) ? homeData.roster : [];
    const awayRoster = Array.isArray(awayData && awayData.roster) ? awayData.roster : [];

    detectCastPlays_(week, selected, homeRoster, awayRoster);

    state.battleCastCache.set(cacheKey, {
      savedAt: Date.now(),
      homeRoster,
      awayRoster,
      homeData,
      awayData
    });

    renderBattleFantasyCast_(selected, homeRoster, awayRoster, week, homeData, awayData);

    if (shouldShowFantasyCast_(selected, homeRoster, awayRoster)) {
      startBattleFantasyCastPolling_();
    } else {
      stopBattleFantasyCastPolling_();
    }
  } catch (error) {
    console.warn('Battle FantasyCast roster load failed:', error);

    if (
      requestSeq === state.battleCastRequestSeq &&
      state.battleCastOpen &&
      state.battleCastSelectedKey === selectionKey &&
      container
    ) {
      container.innerHTML = `
        <div class="fantasycast-unavailable">
          <strong>FantasyCast could not load this matchup.</strong>
          <span>${escapeHtml(error && error.message ? error.message : String(error))}</span>
          <button type="button" data-fantasycast-close>Hide</button>
        </div>
      `;
      const close = container.querySelector('[data-fantasycast-close]');
      if (close) close.addEventListener('click', () => hideBattleFantasyCast_());
    }
  } finally {
    state.battleCastLoading = false;
  }
}
function startBattleFantasyCastPolling_() {
  if (state.battleCastTimer) return;

  state.battleCastTimer = window.setInterval(() => {
    if (state.activeView !== 'battle') {
      stopBattleFantasyCastPolling_();
      return;
    }
    if (document.hidden) return;
    if (state.battleCastOpen) {
      loadBattleFantasyCast_(true);
    }
  }, BATTLE_CAST_REFRESH_MS);
}

function stopBattleFantasyCastPolling_() {
  if (!state.battleCastTimer) return;
  window.clearInterval(state.battleCastTimer);
  state.battleCastTimer = null;
}

function battleStarterPlayers_(homeRoster, awayRoster) {
  const home = normalizeBattleLineup_(homeRoster).starters.filter(Boolean);
  const away = normalizeBattleLineup_(awayRoster).starters.filter(Boolean);
  return home.concat(away);
}

function battleStarterStatusSummary_(homeRoster, awayRoster) {
  const starters = battleStarterPlayers_(homeRoster, awayRoster);
  const statuses = starters.map(battlePlayerGameStatus_).filter(Boolean);
  const hasLive = statuses.some(status => status === 'LIVE' || status === 'IN_PROGRESS');
  const hasUpcoming = statuses.some(status => status === 'PRE' || status === 'SCHEDULED' || status === 'UPCOMING' || !status);
  const complete = statuses.length > 0 && statuses.every(status => status === 'FINAL' || status === 'POST');
  return { starters, statuses, hasLive, hasUpcoming, complete };
}

function shouldShowFantasyCast_(match, homeRoster, awayRoster) {
  if (!state.battleCastOpen) return false;
  if (Number(state.selectedWeek || 1) !== Number(state.league && state.league.currentWeek || 1)) return false;

  // Bench/IR do NOT control the matchup clock. Once every starter on both
  // teams is FINAL, the fantasy matchup is complete and automatic polling stops.
  const summary = battleStarterStatusSummary_(homeRoster, awayRoster);
  return !summary.complete;
}

function battleFantasyCastModeLabel_(homeRoster, awayRoster) {
  const summary = battleStarterStatusSummary_(homeRoster, awayRoster);
  if (summary.hasLive) return 'LIVE FANTASYCAST';
  if (summary.complete) return 'COMPLETED FANTASYCAST';
  return 'FANTASYCAST PREVIEW';
}

function renderBattleFantasyCast_(match, homeRoster, awayRoster, week, homeData = null, awayData = null) {
  const container = document.getElementById('battleFantasyCast');
  if (!container) return;

  const home = state.teamMap.get(Number(match.homeTeamId));
  const away = state.teamMap.get(Number(match.awayTeamId));
  const homeLineup = normalizeBattleLineup_(homeRoster);
  const awayLineup = normalizeBattleLineup_(awayRoster);

  const homeProjection = Number.isFinite(Number(homeData && homeData.teamProjectedPoints))
    ? Number(homeData.teamProjectedPoints)
    : rosterProjectionTotal_(homeLineup.starters);
  const awayProjection = Number.isFinite(Number(awayData && awayData.teamProjectedPoints))
    ? Number(awayData.teamProjectedPoints)
    : rosterProjectionTotal_(awayLineup.starters);
  const homeScore = Number.isFinite(Number(homeData && homeData.teamFantasyPoints))
    ? Number(homeData.teamFantasyPoints)
    : Number(match.homeScore || 0);
  const awayScore = Number.isFinite(Number(awayData && awayData.teamFantasyPoints))
    ? Number(awayData.teamFantasyPoints)
    : Number(match.awayScore || 0);
  const chance = battleWinChance_(homeScore, awayScore, homeProjection, awayProjection);
  const starterStatus = battleStarterStatusSummary_(homeRoster, awayRoster);
  const hasLive = starterStatus.hasLive;
  const isComplete = starterStatus.complete;

  container.innerHTML = `
    <div class="fantasycast-shell">
      <div class="fantasycast-topbar">
        <div>
          <span class="fantasycast-live-dot"></span>
          <strong>${battleFantasyCastModeLabel_(homeRoster, awayRoster)}</strong>
        </div>

        <div class="fantasycast-topbar-actions">
          <span>WEEK ${week} · ${isComplete ? 'COMPLETED' : hasLive ? 'LIVE · AUTO REFRESH 60 SEC' : 'SCHEDULED · AUTO REFRESH 60 SEC'}</span>
          <button type="button" class="fantasycast-refresh-button" data-fantasycast-refresh aria-label="Refresh FantasyCast now">
            <span>Refresh</span>
            <strong>↻</strong>
          </button>
          <button type="button" class="fantasycast-hide-button" data-fantasycast-close aria-label="Hide FantasyCast">
            <span>Hide</span>
            <strong>×</strong>
          </button>
        </div>
      </div>

      <div class="fantasycast-scoreboard">
        ${fantasyCastTeamHeader_(home, homeScore, homeProjection, 'left')}
        <div class="fantasycast-center">
          <span>${isComplete ? 'FINAL' : 'CHANCE TO WIN'}</span>
          <strong>${isComplete ? `${number2(homeScore)} <em>VS</em> ${number2(awayScore)}` : `${chance.home}% <em>VS</em> ${chance.away}%`}</strong>
        </div>
        ${fantasyCastTeamHeader_(away, awayScore, awayProjection, 'right')}
      </div>

      <div class="fantasycast-winbar" aria-label="Chance to win">
        <span style="width:${chance.home}%"></span>
      </div>

      <div class="fantasycast-lineup-head">
        <span>${escapeHtml(home ? home.name : 'Home')}</span>
        <strong>STARTING LINEUPS</strong>
        <span>${escapeHtml(away ? away.name : 'Away')}</span>
      </div>

      <div class="fantasycast-lineups">
        ${BATTLE_STARTER_SLOT_ORDER.map((slot, index) =>
          fantasyCastMatchupRow_(
            homeLineup.starters[index] || null,
            awayLineup.starters[index] || null,
            slot
          )
        ).join('')}
      </div>

      <div class="fantasycast-bench-title">BENCH</div>
      <div class="fantasycast-lineups fantasycast-bench">
        ${Array.from({ length: Math.max(homeLineup.bench.length, awayLineup.bench.length) }, (_, index) =>
          fantasyCastMatchupRow_(
            homeLineup.bench[index] || null,
            awayLineup.bench[index] || null,
            'BENCH'
          )
        ).join('')}
      </div>
    </div>
  `;

  container.classList.add('is-open');

  applyCastMotion_(container, match, week, { homeScore, awayScore, chance, home, away });

  const closeButton = container.querySelector('[data-fantasycast-close]');
  if (closeButton) {
    closeButton.addEventListener('click', () => hideBattleFantasyCast_());
  }

  const refreshButton = container.querySelector('[data-fantasycast-refresh]');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      state.battleCastCache.clear();
      loadBattleFantasyCast_(true);
    });
  }

  updateBattleCastSelectionUi_();
}

function fantasyCastTeamHeader_(team, score, projection, side) {
  return `
    <div class="fantasycast-team fantasycast-team-${side}">
      <img class="${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="" ${teamIconFallbackAttr(team)}>
      <div>
        <strong>${escapeHtml(team ? team.name : 'Unknown Team')}</strong>
        <span>${escapeHtml(team ? ownerText(team) : '')}</span>
        <div class="fantasycast-score">${number2(score)}</div>
        <small>${projection > 0 ? `PROJ ${projection.toFixed(1)}` : 'PROJECTION PENDING'}</small>
      </div>
    </div>
  `;
}

function normalizeBattleLineup_(roster) {
  const players = Array.isArray(roster) ? roster.slice() : [];
  const starters = players.filter(player => !isBattleBenchPlayer_(player));
  const bench = players.filter(player => isBattleBenchPlayer_(player) && !isBattleIrPlayer_(player));

  const used = new Set();
  const orderedStarters = BATTLE_STARTER_SLOT_ORDER.map(slot => {
    const index = starters.findIndex((player, i) => !used.has(i) && battleSlotMatches_(player, slot));
    if (index < 0) return null;
    used.add(index);
    return starters[index];
  });

  // If ESPN uses an unfamiliar slot label, do not lose the player.
  starters.forEach((player, index) => {
    if (used.has(index)) return;
    const empty = orderedStarters.findIndex(value => value == null);
    if (empty >= 0) orderedStarters[empty] = player;
  });

  return { starters: orderedStarters, bench };
}

function battleSlotMatches_(player, expected) {
  const slot = String(player && (player.lineupSlot || player.slot || '') || '').toUpperCase();
  const pos = String(player && player.position || '').toUpperCase();

  if (expected === 'FLEX') {
    return ['FLEX', 'RB/WR/TE', 'WR/RB/TE', 'OP'].includes(slot);
  }
  if (expected === 'D/ST') {
    return ['D/ST', 'DST', 'DEF'].includes(slot) || ['D/ST', 'DST', 'DEF'].includes(pos);
  }
  return slot === expected || (!slot && pos === expected);
}

function isBattleBenchPlayer_(player) {
  const slot = String(player && (player.lineupSlot || player.slot || '') || '').toUpperCase();
  return ['BE', 'BENCH', 'IR', 'RES', 'RESERVE'].includes(slot);
}

function isBattleIrPlayer_(player) {
  const slot = String(player && (player.lineupSlot || player.slot || '') || '').toUpperCase();
  return ['IR', 'RES', 'RESERVE'].includes(slot);
}

function fantasyCastMatchupRow_(left, right, slot) {
  return `
    <div class="fantasycast-row">
      ${fantasyCastPlayer_(left, 'left')}
      <div class="fantasycast-slot">${escapeHtml(slot)}</div>
      ${fantasyCastPlayer_(right, 'right')}
    </div>
  `;
}

function fantasyCastPlayer_(player, side) {
  if (!player) {
    return `<div class="fantasycast-player fantasycast-player-${side} is-empty"><span>Empty</span></div>`;
  }

  const actual = battlePlayerActualPoints_(player);
  const projection = battlePlayerProjection_(player);
  const status = battlePlayerStatusLabel_(player);
  const opponent = battlePlayerOpponent_(player);
  const injury = String(player.injuryStatus || '').toUpperCase();
  const injuryBadge = injury && injury !== 'ACTIVE'
    ? `<b class="fantasycast-injury">${escapeHtml(injury)}</b>`
    : '';

  return `
    <div class="fantasycast-player fantasycast-player-${side}">
      <div class="fantasycast-player-main">
        <strong>${escapeHtml(player.name || 'Unknown Player')}</strong>
        ${injuryBadge}
        <span>${escapeHtml(player.proTeam || player.proTeamAbbrev || '')}${opponent ? ` · ${escapeHtml(opponent)}` : ''}</span>
        <small class="${status.className}">${escapeHtml(status.text)}</small>
      </div>
      <div class="fantasycast-player-score">
        <strong>${actual == null ? '--' : actual.toFixed(1)}</strong>
        <span>${projection == null ? 'PROJ --' : `PROJ ${projection.toFixed(1)}`}</span>
      </div>
    </div>
  `;
}

function battlePlayerActualPoints_(player) {
  const candidates = [
    player.fantasyPoints, player.points, player.actualPoints,
    player.currentPoints, player.score, player.totalPoints
  ];
  for (const value of candidates) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function battlePlayerProjection_(player) {
  const candidates = [
    player.projectedPoints, player.projection, player.projectedScore,
    player.projectedFantasyPoints, player.seasonProjectedPoints
  ];
  for (const value of candidates) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function rosterProjectionTotal_(starters) {
  return starters.reduce((sum, player) => sum + (battlePlayerProjection_(player) || 0), 0);
}

function battlePlayerGameStatus_(player) {
  return String(
    player.gameStatus || player.proGameStatus || player.status || player.gameState || ''
  ).toUpperCase();
}

function battleHasLivePlayers_(players) {
  return players.some(player => ['LIVE', 'IN_PROGRESS'].includes(battlePlayerGameStatus_(player)));
}

function battlePlayerStatusLabel_(player) {
  const status = battlePlayerGameStatus_(player);
  const clock = player.gameClock || player.clock || '';
  const period = player.period || player.quarter || '';

  if (status === 'LIVE' || status === 'IN_PROGRESS') {
    return { text: `LIVE${period ? ` · Q${period}` : ''}${clock ? ` ${clock}` : ''}`, className: 'is-live' };
  }
  if (status === 'FINAL' || status === 'POST') {
    return { text: 'COMPLETED', className: 'is-final' };
  }

  const kickoff = player.kickoff || player.gameTime || player.startTime || '';
  if (kickoff) {
    const date = new Date(kickoff);
    if (!Number.isNaN(date.getTime())) {
      const day = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      const md = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return { text: `${day} ${md} · ${time}`, className: 'is-upcoming' };
    }
  }

  return { text: 'UPCOMING', className: 'is-upcoming' };
}

function battlePlayerOpponent_(player) {
  const opponent = player.opponent || player.opponentAbbrev || player.proOpponent || '';
  if (!opponent) return '';
  const away = player.isAway === true || String(player.homeAway || '').toUpperCase() === 'AWAY';
  return `${away ? '@' : 'vs'} ${opponent}`;
}

function battleWinChance_(homeScore, awayScore, homeProjection, awayProjection) {
  const homeBase = Math.max(0, Number(homeScore || 0)) + Math.max(0, Number(homeProjection || 0));
  const awayBase = Math.max(0, Number(awayScore || 0)) + Math.max(0, Number(awayProjection || 0));
  const total = homeBase + awayBase;

  if (total <= 0) return { home: 50, away: 50 };

  const home = Math.max(5, Math.min(95, Math.round((homeBase / total) * 100)));
  return { home, away: 100 - home };
}

function getMatchupStory(match, week) {
  const key = storylineKey(week, match.homeTeamId, match.awayTeamId);
  const manual = MATCHUP_STORYLINES[key];

  if (manual) return manual;

  const home = state.teamMap.get(Number(match.homeTeamId));
  const away = state.teamMap.get(Number(match.awayTeamId));

  return buildDefaultStory(home, away, week);
}

function buildDefaultStory(home, away, week) {
  const homeDivision = Number(home && home.divisionId);
  const awayDivision = Number(away && away.divisionId);

  const sameConference =
    Number.isFinite(homeDivision) &&
    Number.isFinite(awayDivision) &&
    homeDivision === awayDivision;

  const title =
    `${home ? home.name : 'Team'} vs ${away ? away.name : 'Team'}`;

  const homeStanding =
    getStandingForTeam_(home && home.id);

  const awayStanding =
    getStandingForTeam_(away && away.id);

  const homeRank = safeRank_(homeStanding);
  const awayRank = safeRank_(awayStanding);

  const homeRecord =
    homeStanding
      ? `${Number(homeStanding.wins || 0)}-${Number(homeStanding.losses || 0)}`
      : '';

  const awayRecord =
    awayStanding
      ? `${Number(awayStanding.wins || 0)}-${Number(awayStanding.losses || 0)}`
      : '';

  let eyebrow = `Week ${week} Battle`;
  let tag =
    sameConference
      ? 'Conference Clash'
      : 'Cross-Conference Battle';

  let reason;

  if (homeRank <= 4 && awayRank <= 4) {
    eyebrow = 'Contender Showdown';
    tag = 'Top Teams Collide';
    reason =
      `${home ? home.name : 'Team'} (${homeRecord}) and ` +
      `${away ? away.name : 'Team'} (${awayRecord}) enter Week ${week} ` +
      `as two of the league's top contenders.`;
  } else if (sameConference) {
    eyebrow = 'Conference Race';
    tag = 'Conference Clash';
    reason =
      `A Week ${week} conference matchup with direct positioning and ` +
      `bragging rights in the ${home && home.division ? home.division : 'conference'} race.`;
  } else if (
    (home && home.defendingChampion) ||
    (away && away.defendingChampion)
  ) {
    eyebrow = 'Champion Watch';
    tag = 'Defending Champion';
    reason =
      `The defending champion is back in the spotlight for Week ${week}, ` +
      `but this matchup earned its place based on the overall weekly matchup ranking.`;
  } else {
    reason =
      `A Week ${week} matchup selected automatically from standings, ` +
      `records, scoring strength, and weekly stakes in the Zenni Cup race.`;
  }

  return {
    featured: false,
    eyebrow,
    title,
    subtitle: title,
    reason,
    tag
  };
}

function storylineKey(week, firstTeamId, secondTeamId) {
  const ids = [Number(firstTeamId), Number(secondTeamId)].sort((a, b) => a - b);
  return `${Number(week)}:${ids[0]}-${ids[1]}`;
}

function animateBattleEntrance() {
  document.querySelectorAll('.battle-fighter, .battle-card').forEach(element => {
    element.classList.remove('battle-entered');
  });

  requestAnimationFrame(() => {
    document.querySelectorAll('.battle-fighter, .battle-card').forEach(element => {
      element.classList.add('battle-entered');
    });
  });
}

function startBattleFightLoop_() {
  stopBattleFightLoop_();

  if (window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const stage = document.querySelector('#battleFeatured .motw-stage');

  if (!stage || state.activeView !== 'battle') {
    return;
  }

  battleAnimationState.activeStage = stage;
  battleAnimationState.cycle += 1;

  // First fight happens quickly after the entrance settles.
  runBattleFightSequence_(stage);

  // Then let the arena breathe before repeating.
  battleAnimationState.timer = window.setInterval(() => {
    if (
      state.activeView !== 'battle' ||
      !stage.isConnected ||
      battleAnimationState.activeStage !== stage
    ) {
      stopBattleFightLoop_();
      return;
    }

    runBattleFightSequence_(stage);
  }, 7600);
}

function stopBattleFightLoop_() {
  if (battleAnimationState.timer) {
    window.clearInterval(battleAnimationState.timer);
    battleAnimationState.timer = null;
  }

  if (battleAnimationState.sequenceTimer) {
    window.clearTimeout(battleAnimationState.sequenceTimer);
    battleAnimationState.sequenceTimer = null;
  }

  const stage = battleAnimationState.activeStage;

  if (stage && stage.isConnected) {
    clearBattleFightClasses_(stage);
  }

  battleAnimationState.activeStage = null;
}

function clearBattleFightClasses_(stage) {
  if (!stage) return;

  stage.classList.remove(
    'fight-staredown',
    'fight-charge',
    'fight-impact',
    'fight-recoil',
    'fight-reset'
  );
}

function runBattleFightSequence_(stage) {
  if (
    !stage ||
    !stage.isConnected ||
    state.activeView !== 'battle'
  ) {
    return;
  }

  if (battleAnimationState.sequenceTimer) {
    window.clearTimeout(battleAnimationState.sequenceTimer);
    battleAnimationState.sequenceTimer = null;
  }

  clearBattleFightClasses_(stage);

  const phase = (className, delay, next) => {
    battleAnimationState.sequenceTimer = window.setTimeout(() => {
      if (
        !stage.isConnected ||
        state.activeView !== 'battle' ||
        battleAnimationState.activeStage !== stage
      ) {
        return;
      }

      clearBattleFightClasses_(stage);

      if (className) {
        stage.classList.add(className);
      }

      if (typeof next === 'function') {
        next();
      }
    }, delay);
  };

  stage.classList.add('fight-staredown');

  phase('fight-charge', 850, () => {
    phase('fight-impact', 520, () => {
      triggerBattleImpactParticles_(stage);

      phase('fight-recoil', 320, () => {
        phase('fight-reset', 560, () => {
          phase('', 650);
        });
      });
    });
  });
}

function triggerBattleImpactParticles_(stage) {
  const impact = stage.querySelector('.battle-impact');
  if (!impact) return;

  impact.classList.remove('impact-burst');

  // Force reflow so each fight can replay the burst animation.
  void impact.offsetWidth;

  impact.classList.add('impact-burst');

  window.setTimeout(() => {
    impact.classList.remove('impact-burst');
  }, 900);
}

function renderStandings() {
  renderConferenceStandings(0, 'afcStandings');
  renderConferenceStandings(1, 'nfcStandings');
}


function renderStandingsPreview() {
  const container = document.getElementById('standingsPreview');
  if (!container) return;

  const rows = state.standings.slice().sort((a, b) => {
    const rankA = a.overallRank == null ? 999 : Number(a.overallRank);
    const rankB = b.overallRank == null ? 999 : Number(b.overallRank);
    return rankA - rankB;
  });

  const previewRows = rows.length >= 4 ? [rows[0], rows[1], rows[2], rows[rows.length - 1]] : rows;

  if (!previewRows.length) {
    container.innerHTML = '<div class="error-panel">Standings preview is not available yet.</div>';
    return;
  }

  container.innerHTML = `
    <div class="standings-preview-head">
      <span>Team</span>
      <span>W-L</span>
      <span>PF</span>
    </div>
    ${previewRows.map((row, index) => {
      const team = state.teamMap.get(Number(row.teamId));
      const rankLabel = row.overallRank == null ? (index === previewRows.length - 1 && previewRows.length > 3 ? state.teams.length : '--') : row.overallRank;
      return `
        <div class="standings-preview-row ${index === 0 ? 'is-top' : ''}">
          <div class="standings-preview-teamwrap">
            <div class="standings-preview-rank">${escapeHtml(String(rankLabel))}</div>
            <img class="standing-logo custom-team-icon ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="" ${teamIconFallbackAttr(team)}>
            <div class="standing-name">
              <strong>${escapeHtml(row.teamName)}</strong>
              <span>${escapeHtml(team ? ownerText(team) : '')}</span>
            </div>
          </div>
          <div class="standings-mini-record">${row.wins}-${row.losses}</div>
          <div class="standings-mini-pf">${number2(row.pointsFor)}</div>
        </div>
      `;
    }).join('')}
  `;
}

function renderGlanceRibbon() {
  const container = document.getElementById('glanceRibbon');
  if (!container || !state.league) return;

  const afcTeams = state.teams.filter(team => Number(team.divisionId) === 0).length;
  const nfcTeams = state.teams.filter(team => Number(team.divisionId) === 1).length;

  const items = [
    ['At a Glance', '', ''],
    ['👥', state.league.teamCount, 'Teams'],
    ['🅰️', afcTeams, 'AFC Teams'],
    ['🅽', nfcTeams, 'NFC Teams'],
    ['📅', state.league.regularSeasonWeeks, 'Regular Season Weeks'],
    ['🏆', state.league.playoffTeams, 'Playoff Spots']
  ];

  container.innerHTML = items.map((item, index) => {
    if (index === 0) {
      return `<div class="glance-item glance-label"><span class="section-kicker">${item[0]}</span></div>`;
    }
    return `
      <div class="glance-item">
        <span class="glance-icon">${item[0]}</span>
        <strong>${escapeHtml(String(item[1]))}</strong>
        <small>${escapeHtml(item[2])}</small>
      </div>
    `;
  }).join('');
}

function renderConferenceStandings(divisionId, targetId) {
  const target = document.getElementById(targetId);

  const rows = state.standings
    .filter(row => Number(row.divisionId) === Number(divisionId))
    .sort((a, b) => {
      if (a.divisionRank == null && b.divisionRank == null) {
        return Number(a.teamId) - Number(b.teamId);
      }
      return Number(a.divisionRank || 99) - Number(b.divisionRank || 99);
    });

  target.innerHTML = rows.map(row => {
    const team = state.teamMap.get(Number(row.teamId));
    const rank = row.divisionRank == null ? '--' : row.divisionRank;

    return `
      <tr data-team-id="${row.teamId}">
        <td class="${rank === '--' ? 'rank-dash' : ''}">${rank}</td>
        <td>
          <div class="standings-team">
            <img class="standing-logo custom-team-icon ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="" ${teamIconFallbackAttr(team)}>
            <div class="standing-name">
              <strong>
                ${escapeHtml(row.teamName)}
                ${row.defendingChampion ? '<span class="champion-crown">♛</span>' : ''}
              </strong>
              <span>${escapeHtml(team ? ownerText(team) : '')}</span>
            </div>
          </div>
        </td>
        <td>${row.wins}-${row.losses}-${row.ties}</td>
        <td>${number2(row.pointsFor)}</td>
        <td>${escapeHtml(row.streak || '-')}</td>
      </tr>
    `;
  }).join('');
}

function renderTeamGallery() {
  const grid = document.getElementById('teamGrid');

  grid.innerHTML = state.teams.map(team => `
    <article class="team-card ${team.defendingChampion ? 'is-champion' : ''}" data-team-id="${team.id}" tabindex="0" role="button" aria-label="Open ${escapeAttr(team.name)}">
      <div class="team-card-top">
        <img class="team-logo custom-team-icon ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="${escapeAttr(team.name)} mascot" ${teamIconFallbackAttr(team)}>
        <div>
          <h3>${escapeHtml(team.name)} ${team.defendingChampion ? '👑' : ''}</h3>
          <p>${escapeHtml(ownerText(team))}</p>
        </div>
      </div>
      <div class="team-card-bottom">
        <span>${escapeHtml(team.division)}</span>
        <span>${team.wins}-${team.losses}-${team.ties}</span>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.team-card').forEach(card => {
    const open = () => openTeamModal(Number(card.dataset.teamId));

    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

async function openTeamModal(teamId) {
  const modal = document.getElementById('teamModal');
  const content = document.getElementById('teamModalContent');
  const team = state.teamMap.get(Number(teamId));

  content.innerHTML = `
    <div class="modal-head">
      <img class="modal-team-mascot ${teamIconClass(team)}" src="${escapeAttr(getTeamIcon(team))}" alt="${escapeAttr(team ? team.name : 'Team')} mascot" ${teamIconFallbackAttr(team)}>
      <div>
        <span class="section-kicker">${escapeHtml(team ? team.division : '')}</span>
        <h2>${escapeHtml(team ? team.name : 'Team')}</h2>
        <p>${escapeHtml(team ? ownerText(team) : '')}</p>
        <button type="button" class="follow-button" data-follow-toggle></button>
      </div>
    </div>
    <div class="roster-list">
      <div class="skeleton-block"></div>
    </div>
  `;

  modal.showModal();

  const followButton = content.querySelector('[data-follow-toggle]');
  if (followButton) {
    const syncFollow = () => {
      const mine = getMyTeamId_() === Number(teamId);
      followButton.textContent = mine ? '★ My team · tap to unfollow' : '☆ This is my team';
      followButton.classList.toggle('is-on', mine);
    };

    syncFollow();

    followButton.addEventListener('click', () => {
      setMyTeamId_(getMyTeamId_() === Number(teamId) ? null : Number(teamId));
      syncFollow();
    });
  }

  try {
    const data = await api_('roster', { teamId });
    const roster = Array.isArray(data.roster) ? data.roster : [];

    content.querySelector('.roster-list').innerHTML = roster.length
      ? roster.map(player => `
          <div class="roster-row">
            <div class="roster-slot">${escapeHtml(player.lineupSlot || player.position || '')}</div>
            <div class="roster-name">
              <strong>${escapeHtml(player.name)}</strong>
              <span>${escapeHtml(player.position || '')}</span>
            </div>
            <div class="injury">${player.injuryStatus && player.injuryStatus !== 'ACTIVE' ? escapeHtml(player.injuryStatus) : ''}</div>
          </div>
        `).join('')
      : '<div class="error-panel">Roster is not available yet.</div>';
  } catch (error) {
    content.querySelector('.roster-list').innerHTML =
      `<div class="error-panel">${escapeHtml(error.message)}</div>`;
  }
}

function renderFatalError(error) {
  const message = escapeHtml(error.message || String(error));

  ['featuredMatchup', 'leaguePulse', 'overviewTopStats', 'overviewMatchups', 'battleFeatured', 'battleGrid', 'standingsPreview', 'championSpotlight'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.innerHTML = `<div class="error-panel">${message}<div class="fatal-actions"><button type="button" class="performer-tab" data-fatal-retry>Try again</button></div></div>`;
    }
  });

  document.querySelectorAll('[data-fatal-retry]').forEach(button => {
    button.addEventListener('click', () => window.location.reload());
  });
}

function setApiStatus(ok, text) {
  const pill = document.getElementById('apiStatus');
  pill.classList.remove('is-live', 'is-error', 'is-refreshing');
  pill.classList.add(ok ? 'is-live' : 'is-error');

  // "Updating" / "refreshing" = a request is in flight right now.
  if (/updating|refreshing|reconnecting/i.test(String(text))) pill.classList.add('is-refreshing');

  const label = pill.querySelector('.api-text') || pill.querySelector('span:last-child');
  label.textContent = text;

  renderApiFreshness_();
}

function getTeamIcon(team) {
  if (!team) return '';
  return CUSTOM_TEAM_ICONS[Number(team.id)] || team.logo || '';
}

function teamIconClass(team) {
  if (!team) return 'team-icon-unknown';
  return `team-icon-${Number(team.id)}`;
}

function teamIconFallbackAttr(team) {
  if (!team || !team.logo) {
    return `onerror="this.style.visibility='hidden'"`;
  }

  const fallback = escapeAttr(team.logo);
  return `onerror="this.onerror=null;this.src='${fallback}'"`;
}

function ownerText(team) {
  if (!team || !Array.isArray(team.owners) || !team.owners.length) return 'Owner unavailable';
  return team.owners.join(' & ');
}

function number2(value) {
  return Number(value || 0).toFixed(2);
}

function jsonp(mode, params = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = API_TIMEOUT_MS[mode] || API_TIMEOUT_MS._default;
    const audit = FantasyPerf.start(`JSONP ${mode}`, { params });
    const startedAt = performance.now();

    const callback =
      `zenniJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const query = new URLSearchParams({
      mode,
      callback,
      _: Date.now().toString(),
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)])
      )
    });

    const script = document.createElement('script');
    let settled = false;

    function installLateCallbackGuard_() {
      window[callback] = function lateJsonpNoop_() {
        FantasyPerf.log(`Late JSONP ${mode} response ignored safely`, {
          params
        });
      };

      window.setTimeout(() => {
        try {
          delete window[callback];
        } catch (_) {
          window[callback] = undefined;
        }
      }, 60000);
    }

    function cleanup(keepLateGuard) {
      clearTimeout(timeout);

      if (script.parentNode) {
        script.remove();
      }

      if (keepLateGuard) {
        installLateCallbackGuard_();
      } else {
        try {
          delete window[callback];
        } catch (_) {
          window[callback] = undefined;
        }
      }
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;

      const elapsedMs = performance.now() - startedAt;

      cleanup(true);

      FantasyPerf.log(`JSONP ${mode} TIMEOUT`, {
        elapsedMs: Number(elapsedMs.toFixed(1)),
        timeoutMs: timeoutMs,
        params
      });

      const error =
        new Error('The ESPN fantasy API took too long to respond.');

      audit.fail(error, {
        timeout: true,
        timeoutMs: timeoutMs,
        params
      });

      reject(error);
    }, timeoutMs);

    window[callback] = data => {
      if (settled) return;
      settled = true;

      const elapsedMs = performance.now() - startedAt;

      cleanup(false);

      audit.end({
        success: true,
        responseMs: Number(elapsedMs.toFixed(1)),
        ok: Boolean(data && data.ok),
        params
      });

      resolve(data);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;

      const elapsedMs = performance.now() - startedAt;

      cleanup(true);

      const error =
        new Error('Unable to reach the Zenni Fantasy API.');

      audit.fail(error, {
        networkError: true,
        responseMs: Number(elapsedMs.toFixed(1)),
        params
      });

      reject(error);
    };

    script.src = `${API_URL}?${query.toString()}`;

    FantasyPerf.log(`JSONP ${mode} request appended`, {
      params,
      url: script.src.replace(callback, '<callback>')
    });

    document.body.appendChild(script);
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}