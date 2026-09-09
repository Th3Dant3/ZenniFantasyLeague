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

const LOADER_MINIMUM_MS = 1600;
const LEAGUE_BROWSER_CACHE_KEY = 'ZENNI_FANTASY_LEAGUE_LAST_GOOD_V1';
const LEAGUE_BROWSER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LEAGUE_RETRY_DELAYS_MS = [1200, 2800];

const loaderState = {
  startedAt: Date.now(),
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
  performerRequestToken: 0,
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
  battleCastRequestSeq: 0
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const audit = FantasyPerf.start('INITIAL init');

  bindUi();
  startLeagueLoader();

  try {
    setLoaderTarget(22);

    const leagueAudit = FantasyPerf.start('Startup league resilient');

    let data = null;
    let source = 'live';

    try {
      data = await jsonpWithRetry_('league', {}, LEAGUE_RETRY_DELAYS_MS);

      if (data && data.ok) {
        saveLeagueBrowserCache_(data);
      }

    } catch (liveError) {
      const cached = loadLeagueBrowserCache_();

      if (cached && cached.data && cached.data.ok) {
        data = cached.data;
        source = 'browser-cache';

        FantasyPerf.log(
          'League live request failed; using last-good browser cache',
          {
            cacheAgeMs: cached.ageMs,
            error: liveError.message
          }
        );

        setApiStatus(false, 'Cached Data · Reconnecting');

        refreshLeagueInBackground_();

      } else {
        throw liveError;
      }
    }

    leagueAudit.end({
      leagueOk: Boolean(data && data.ok),
      source
    });

    if (!data || !data.ok) {
      throw new Error(
        data && data.error
          ? data.error
          : 'League API did not return data.'
      );
    }

    setLoaderTarget(58);

    const hydrateAudit = FantasyPerf.start('Hydrate league state');

    hydrateState(data);

    hydrateAudit.end({
      teams: state.teams.length,
      standings: state.standings.length,
      currentMatchups: state.currentMatchups.length,
      source
    });

    setLoaderTarget(78);

    const renderAudit = FantasyPerf.start('Initial renderAll');

    renderAll();

    renderAudit.end();

    setLoaderTarget(94);

    if (source === 'live') {
      setApiStatus(true, 'ESPN Connected');
    }

    const loaderAudit = FantasyPerf.start('Finish loader success');

    await finishLeagueLoader(true);

    loaderAudit.end();

    audit.end({
      success: true,
      teams: state.teams.length,
      currentWeek: state.selectedWeek,
      source
    });

    FantasyPerf.log(
      `MAIN FANTASY PAGE TIME TO READY: ${FantasyPerf.nowFromNav().toFixed(1)} ms (${(FantasyPerf.nowFromNav() / 1000).toFixed(2)} sec)`,
      { source }
    );

    loadDraftboardInBackground_();

  } catch (error) {
    console.error(error);

    setApiStatus(false, 'API Error');
    renderFatalError(error);

    const loaderAudit = FantasyPerf.start('Finish loader error');

    await finishLeagueLoader(false);

    loaderAudit.end();

    audit.fail(error, {
      success: false
    });

    FantasyPerf.log(
      `FANTASY PAGE FAILED AFTER: ${FantasyPerf.nowFromNav().toFixed(1)} ms (${(FantasyPerf.nowFromNav() / 1000).toFixed(2)} sec)`
    );
  }
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

      return await jsonp(mode, params);

    } catch (error) {
      lastError = error;

      FantasyPerf.log(`JSONP ${mode} attempt ${attempt + 1} failed`, {
        attempt: attempt + 1,
        error: error && error.message ? error.message : String(error)
      });

      if (attempt >= delays.length) {
        break;
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

async function refreshLeagueInBackground_() {
  const audit = FantasyPerf.start('BACKGROUND league recovery');

  try {
    const fresh = await jsonpWithRetry_('league', {}, [3000, 6000]);

    if (!fresh || !fresh.ok) {
      throw new Error(
        fresh && fresh.error
          ? fresh.error
          : 'League recovery did not return data.'
      );
    }

    saveLeagueBrowserCache_(fresh);
    hydrateState(fresh);
    renderAll();

    setApiStatus(true, 'ESPN Connected');

    audit.end({
      success: true,
      refreshedUi: true
    });

  } catch (error) {
    audit.fail(error, {
      success: false,
      cachedPageStillUsable: true
    });

    setApiStatus(false, 'Cached Data');
  }
}

async function loadDraftboardInBackground_() {
  const audit =
    FantasyPerf.start('BACKGROUND draftboard');

  try {
    const draftData =
      await jsonp('draftboard');

    hydrateDraftState(draftData);

    audit.end({
      success: Boolean(
        draftData &&
        draftData.ok
      ),
      picks:
        Number(
          draftData &&
          draftData.draft &&
          Array.isArray(draftData.draft.picks)
            ? draftData.draft.picks.length
            : 0
        )
    });

  } catch (error) {
    /*
     * Draft failure should not downgrade the whole league page.
     * Draft tab already knows how to render unavailable data.
     */
    state.draft = null;

    audit.fail(error, {
      success: false,
      backgroundOnly: true
    });

    console.warn(
      'Draftboard background load failed:',
      error
    );
  }
}


function startLeagueLoader() {
  const loader = document.getElementById('leagueLoader');
  if (!loader) return;

  document.body.classList.add('is-loading');

  updateLoaderUi(4);
  loaderState.target = 16;

  loaderState.timer = window.setInterval(() => {
    if (loaderState.progress >= loaderState.target) return;

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
    if (message) message.textContent = currentStage.message;
  }
}

async function finishLeagueLoader(success) {
  const loader = document.getElementById('leagueLoader');
  if (!loader) return;

  if (loaderState.timer) {
    window.clearInterval(loaderState.timer);
    loaderState.timer = null;
  }

  const headline = document.getElementById('loaderHeadline');
  const message = document.getElementById('loaderMessage');
  const stage = document.getElementById('loaderStage');

  if (success) {
    if (headline) headline.textContent = 'WELCOME TO ZENNI LEAGUE';
    if (message) message.textContent = 'The championship race begins now.';
    if (stage) stage.textContent = 'Ready';
  } else {
    if (headline) headline.textContent = 'ZENNI LEAGUE';
    if (message) message.textContent = 'ESPN connection issue — opening the league shell.';
    if (stage) stage.textContent = 'Limited data mode';
  }

  loaderState.target = 100;

  while (loaderState.progress < 100) {
    updateLoaderUi(Math.min(100, loaderState.progress + 3.4));
    await wait(18);
  }

  const elapsed = Date.now() - loaderState.startedAt;
  if (elapsed < LOADER_MINIMUM_MS) {
    await wait(LOADER_MINIMUM_MS - elapsed);
  }

  loader.classList.add(success ? 'is-ready' : 'is-error');

  await wait(420);

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

  document.getElementById('prevWeek').addEventListener('click', () => changeWeek(-1));
  document.getElementById('nextWeek').addEventListener('click', () => changeWeek(1));
  document.getElementById('battlePrevWeek').addEventListener('click', () => changeWeek(-1));
  document.getElementById('battleNextWeek').addEventListener('click', () => changeWeek(1));

  const modal = document.getElementById('teamModal');
  document.getElementById('modalClose').addEventListener('click', () => modal.close());

  modal.addEventListener('click', event => {
    if (event.target === modal) modal.close();
  });
}

function switchView(view) {
  const nextView = ['overview', 'battle', 'standings', 'teams', 'draft'].includes(view)
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
    renderDraftDay();
  }
}

function hydrateState(data) {
  state.league = data.league;
  state.teams = Array.isArray(data.teams) ? data.teams : [];
  state.teamMap = new Map(state.teams.map(team => [Number(team.id), team]));
  state.standings = Array.isArray(data.standings) ? data.standings : [];
  state.currentMatchups = Array.isArray(data.currentMatchups) ? data.currentMatchups : [];
  state.selectedWeek = Number(data.league.currentWeek || 1);
  state.weekCache.set(state.selectedWeek, state.currentMatchups);

  document.getElementById('heroWeek').textContent = state.league.currentWeek;
  document.getElementById('heroTeams').textContent = state.league.teamCount;
  document.getElementById('heroPlayoffs').textContent = state.league.playoffTeams;

  const generated = data.generatedAt ? new Date(data.generatedAt) : new Date();
  document.getElementById('lastUpdated').textContent =
    `Last ESPN sync: ${generated.toLocaleString()}`;

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
    grid.classList.remove('skeleton-block');
    grid.innerHTML = '<div class="draft-error">Draft data is not available from ESPN yet.</div>';
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

function renderAll() {
  renderChampionSpotlight();
  renderStandings();
  renderStandingsPreview();
  renderTeamGallery();
  renderGlanceRibbon();
  renderWeek(state.currentMatchups, state.selectedWeek);
}

function renderWeek(matchups, week) {
  state.selectedWeek = Number(week);
  syncWeekLabels(week);
  renderOverviewMatchups(matchups, week);
  renderFeaturedMatchup(matchups, week);
  renderBattleCenter(matchups, week);
  renderLeaguePulse(matchups, week);
  renderOverviewTopStats(week);
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

function renderOverviewTopStats(week = state.selectedWeek) {
  const container = document.getElementById('overviewTopStats');
  const weekLabel = document.getElementById('performersWeekLabel');

  if (!container) return;
  if (weekLabel) weekLabel.textContent = `Week ${week}`;

  container.classList.add('skeleton-block');
  container.innerHTML = `
    <div class="performers-loading">
      <strong>Loading weekly player leaders...</strong>
      <span>QB · RB · WR · TE · K · DST</span>
    </div>
  `;

  loadTopPerformers(Number(week));
}

async function loadTopPerformers(week) {
  const container = document.getElementById('overviewTopStats');
  if (!container) return;

  const requestToken = ++state.performerRequestToken;

  try {
    if (!state.playerPerformanceCache.has(week)) {
      const rosterResponses = await Promise.allSettled(
        state.teams.map(async team => {
          const data = await jsonp('roster', { teamId: team.id, week });
          return {
            team,
            roster: Array.isArray(data && data.roster) ? data.roster : []
          };
        })
      );

      const playerPool = [];

      rosterResponses.forEach(result => {
        if (result.status !== 'fulfilled') return;

        const { team, roster } = result.value;
        roster.forEach(player => {
          const points = getWeeklyPlayerPoints(player, week);
          const position = normalizeFantasyPosition(player.position || player.lineupSlot);

          if (!position || points == null) return;

          playerPool.push({
            name: player.name || 'Unknown Player',
            position,
            points,
            nflTeam: getPlayerNflTeam(player),
            fantasyTeam: team.name,
            fantasyTeamId: Number(team.id)
          });
        });
      });

      state.playerPerformanceCache.set(week, playerPool);
    }

    if (requestToken !== state.performerRequestToken || Number(state.selectedWeek) !== Number(week)) {
      return;
    }

    const playerPool = state.playerPerformanceCache.get(week) || [];
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

    const leaders = positions.map(position => {
      return playerPool
        .filter(player => player.position === position)
        .sort((a, b) => b.points - a.points)[0] || null;
    });

    const available = leaders.filter(Boolean);

    container.classList.remove('skeleton-block');

    if (!available.length) {
      container.innerHTML = `
        <div class="performers-empty">
          <strong>Player scoring is waiting on the API.</strong>
          <span>The current roster feed does not include weekly fantasy points yet. The card will populate automatically once the roster response returns a weekly point value.</span>
        </div>
      `;
      return;
    }

    const overall = available.slice().sort((a, b) => b.points - a.points)[0];

    container.innerHTML = leaders.map((leader, index) => {
      const position = positions[index];

      if (!leader) {
        return `
          <div class="performer-row is-pending">
            <div class="performer-position">${position}</div>
            <div class="performer-copy">
              <strong>Scoring pending</strong>
              <span>Waiting for ESPN player points</span>
            </div>
            <div class="performer-points">—</div>
          </div>
        `;
      }

      const isPlayerOfWeek =
        overall &&
        leader.name === overall.name &&
        leader.position === overall.position &&
        Number(leader.points) === Number(overall.points);

      return `
        <div class="performer-row ${isPlayerOfWeek ? 'is-player-week' : ''}">
          <div class="performer-position">${escapeHtml(position)}</div>
          <div class="performer-copy">
            <div class="performer-name-line">
              <strong>${escapeHtml(leader.name)}</strong>
              ${isPlayerOfWeek ? '<span class="player-week-badge">Player of Week</span>' : ''}
            </div>
            <span>${escapeHtml(leader.nflTeam)} · ${escapeHtml(leader.fantasyTeam)}</span>
          </div>
          <div class="performer-points">
            <strong>${number2(leader.points)}</strong>
            <small>PTS</small>
          </div>
        </div>
      `;
    }).join('');
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

function getWeeklyPlayerPoints(player, week) {
  if (!player || typeof player !== 'object') return null;

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

function renderLeaguePulse(matchups = state.currentMatchups, week = state.selectedWeek) {
  const container = document.getElementById('leaguePulse');
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
  if (state.weekCache.has(Number(week))) {
    return state.weekCache.get(Number(week));
  }

  const data = await jsonp('matchups', { week });
  const matchups = Array.isArray(data.matchups) ? data.matchups : [];
  state.weekCache.set(Number(week), matchups);
  return matchups;
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
    state.battleCastSelectedKey = featuredKey;
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

const BATTLE_CAST_REFRESH_MS = 30000;
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
      renderBattleFantasyCast_(selected, cached.homeRoster, cached.awayRoster, week);
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
  if (container && state.battleCastOpen) {
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
      jsonp('roster', { teamId: homeId }),
      jsonp('roster', { teamId: awayId })
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

    state.battleCastCache.set(cacheKey, {
      savedAt: Date.now(),
      homeRoster,
      awayRoster
    });

    renderBattleFantasyCast_(selected, homeRoster, awayRoster, week);

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

function shouldShowFantasyCast_(match, homeRoster, awayRoster) {
  if (Number(match.homeScore || 0) > 0 || Number(match.awayScore || 0) > 0) return true;

  const players = [...homeRoster, ...awayRoster];
  if (players.some(player => {
    const status = battlePlayerGameStatus_(player);
    return ['LIVE', 'IN_PROGRESS', 'FINAL', 'POST'].includes(status);
  })) return true;

  // Fallback when ESPN's roster payload does not expose NFL game status.
  // FantasyCast automatically becomes the Battle Center presentation Thu-Mon
  // for the current fantasy week.
  const day = new Date().getDay(); // Sun 0 ... Sat 6
  return day === 0 || day === 1 || day === 4 || day === 5 || day === 6;
}


function battleFantasyCastModeLabel_(players, match) {
  const statuses = players.map(battlePlayerGameStatus_);
  if (statuses.some(status => status === 'LIVE' || status === 'IN_PROGRESS')) {
    return 'LIVE FANTASYCAST';
  }
  if (
    statuses.length &&
    statuses.every(status => !status || status === 'FINAL' || status === 'POST') &&
    (Number(match.homeScore || 0) > 0 || Number(match.awayScore || 0) > 0)
  ) {
    return 'FINAL FANTASYCAST';
  }
  return 'FANTASYCAST PREVIEW';
}

function renderBattleFantasyCast_(match, homeRoster, awayRoster, week) {
  const container = document.getElementById('battleFantasyCast');
  if (!container) return;

  const home = state.teamMap.get(Number(match.homeTeamId));
  const away = state.teamMap.get(Number(match.awayTeamId));
  const homeLineup = normalizeBattleLineup_(homeRoster);
  const awayLineup = normalizeBattleLineup_(awayRoster);

  const homeProjection = rosterProjectionTotal_(homeLineup.starters);
  const awayProjection = rosterProjectionTotal_(awayLineup.starters);
  const homeScore = Number(match.homeScore || 0);
  const awayScore = Number(match.awayScore || 0);
  const chance = battleWinChance_(homeScore, awayScore, homeProjection, awayProjection);

  container.innerHTML = `
    <div class="fantasycast-shell">
      <div class="fantasycast-topbar">
        <div>
          <span class="fantasycast-live-dot"></span>
          <strong>${battleFantasyCastModeLabel_([...homeRoster, ...awayRoster], match)}</strong>
        </div>

        <div class="fantasycast-topbar-actions">
          <span>WEEK ${week} · AUTO REFRESH 30 SEC</span>
          <button type="button" class="fantasycast-hide-button" data-fantasycast-close aria-label="Hide FantasyCast">
            <span>Hide</span>
            <strong>×</strong>
          </button>
        </div>
      </div>

      <div class="fantasycast-scoreboard">
        ${fantasyCastTeamHeader_(home, homeScore, homeProjection, 'left')}
        <div class="fantasycast-center">
          <span>CHANCE TO WIN</span>
          <strong>${chance.home}% <em>VS</em> ${chance.away}%</strong>
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

  const closeButton = container.querySelector('[data-fantasycast-close]');
  if (closeButton) {
    closeButton.addEventListener('click', () => hideBattleFantasyCast_());
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
    return { text: 'FINAL', className: 'is-final' };
  }

  const kickoff = player.kickoff || player.gameTime || player.startTime || '';
  return { text: kickoff ? String(kickoff) : 'UPCOMING', className: 'is-upcoming' };
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
      <tr>
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
      </div>
    </div>
    <div class="roster-list">
      <div class="skeleton-block"></div>
    </div>
  `;

  modal.showModal();

  try {
    const data = await jsonp('roster', { teamId });
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
    if (element) element.innerHTML = `<div class="error-panel">${message}</div>`;
  });
}

function setApiStatus(ok, text) {
  const pill = document.getElementById('apiStatus');
  pill.classList.remove('is-live', 'is-error');
  pill.classList.add(ok ? 'is-live' : 'is-error');
  pill.querySelector('span:last-child').textContent = text;
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
        timeoutMs: 15000,
        params
      });

      const error =
        new Error('The ESPN fantasy API took too long to respond.');

      audit.fail(error, {
        timeout: true,
        timeoutMs: 15000,
        params
      });

      reject(error);
    }, 15000);

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
