const API_URL =
  'https://script.google.com/macros/s/AKfycbzKMV9Vy3fq2UQlT8Z5Ll67gsEieLE1EhrFQ13hnENcNzp2FOX-2lBv402tSvivKeriOg/exec';

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
  draftSelectedTeamId: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindUi();
  startLeagueLoader();

  try {
    setLoaderTarget(22);
    const [data, draftData] = await Promise.all([
      jsonp('league'),
      jsonp('draftboard').catch(error => ({ ok: false, error: error.message }))
    ]);

    if (!data || !data.ok) {
      throw new Error(data && data.error ? data.error : 'League API did not return data.');
    }

    setLoaderTarget(58);
    hydrateState(data);
    hydrateDraftState(draftData);

    setLoaderTarget(78);
    renderAll();

    setLoaderTarget(94);
    setApiStatus(true, 'ESPN Connected');

    await finishLeagueLoader(true);
  } catch (error) {
    console.error(error);
    setApiStatus(false, 'API Error');
    renderFatalError(error);
    await finishLeagueLoader(false);
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
  const explicit = matchups.find(match => getMatchupStory(match, week).featured);
  if (explicit) return explicit;

  const champion = state.teams.find(team => team.defendingChampion);

  if (champion) {
    const championMatch = matchups.find(match =>
      Number(match.homeTeamId) === Number(champion.id) ||
      Number(match.awayTeamId) === Number(champion.id)
    );

    if (championMatch) return championMatch;
  }

  return matchups
    .slice()
    .sort((a, b) =>
      (Number(b.homeScore) + Number(b.awayScore)) -
      (Number(a.homeScore) + Number(a.awayScore))
    )[0];
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

  setWeekLoading(next);

  try {
    const matchups = await getWeekMatchups(next);
    renderWeek(matchups, next);
  } catch (error) {
    renderWeekError(error, next);
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
      <article class="overview-matchup-card ${featured}">
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
    return;
  }

  const featured = chooseFeaturedMatchup(matchups, week);
  const others = matchups.filter(match => match !== featured);
  const featuredStory = getMatchupStory(featured, week);

  featuredContainer.innerHTML = battleFeaturedMarkup(featured, featuredStory, week);
  grid.innerHTML = others.map((match, index) =>
    battleCardMarkup(match, getMatchupStory(match, week), index)
  ).join('');

  requestAnimationFrame(animateBattleEntrance);
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
    <article class="battle-card" style="--battle-delay:${index * 90}ms">
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
  const sameConference = Number.isFinite(homeDivision) &&
    Number.isFinite(awayDivision) &&
    homeDivision === awayDivision;

  const tag = sameConference ? 'Conference Clash' : 'Cross-Conference Battle';
  const title = `${home ? home.name : 'Team'} vs ${away ? away.name : 'Team'}`;
  const reason = sameConference
    ? `A Week ${week} conference matchup with direct bragging rights inside the ${home && home.division ? home.division : 'division'} race.`
    : `A Week ${week} cross-conference face-off with both teams trying to build momentum toward the Zenni Cup race.`;

  return {
    featured: false,
    eyebrow: `Week ${week} Battle`,
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
    const callback = `zenniJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const query = new URLSearchParams({
      mode,
      callback,
      _: Date.now().toString(),
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)])
      )
    });

    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('The ESPN fantasy API took too long to respond.'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      script.remove();
      delete window[callback];
    }

    window[callback] = data => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Unable to reach the Zenni Fantasy API.'));
    };

    script.src = `${API_URL}?${query.toString()}`;
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
