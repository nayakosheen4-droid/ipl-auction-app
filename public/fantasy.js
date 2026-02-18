// Fantasy League Frontend Logic

const API_BASE = window.location.origin;

// State
let currentTeam = null;
let isAdmin = false;
let currentGameweek = 1;
let allSoldPlayers = [];
let selectedMatchId = null;
let selectedMatchName = null;

// Check session
const savedTeam = localStorage.getItem('currentTeam');
const savedIsAdmin = localStorage.getItem('isAdmin');

if (savedTeam) {
    currentTeam = JSON.parse(savedTeam);
    isAdmin = savedIsAdmin === 'true';
} else {
    // Redirect to login
    window.location.href = '/';
}

// Initialize
async function init() {
    // Show/hide admin nav button
    if (isAdmin) {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }
    
    // Load all sold players for dropdown
    await loadAllSoldPlayers();
    
    // Load current gameweek
    await loadCurrentGameweek();
    
    // Setup event listeners
    setupEventListeners();
    
    // Load initial view
    showView('leaderboard');
}

// Setup event listeners
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.fantasy-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            document.querySelectorAll('.fantasy-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showView(view);
        });
    });
    
    // Back to auction
    document.getElementById('backToAuctionBtn').addEventListener('click', () => {
        window.location.href = '/';
    });
    
    // Logout
    document.getElementById('fantasyLogoutBtn').addEventListener('click', () => {
        localStorage.removeItem('currentTeam');
        localStorage.removeItem('isAdmin');
        window.location.href = '/';
    });
    
    // Gameweek selectors
    document.getElementById('gameweekSelector').addEventListener('change', (e) => {
        currentGameweek = parseInt(e.target.value);
        loadLeaderboard(currentGameweek);
    });
    
    document.getElementById('myteamGameweekSelector').addEventListener('change', (e) => {
        currentGameweek = parseInt(e.target.value);
        loadMyTeamPerformance(currentGameweek);
    });
    
    // Schedule: Load schedule button (visible to ALL users – Schedule tab)
    const loadScheduleBtnMain = document.getElementById('loadScheduleBtnMain');
    if (loadScheduleBtnMain) loadScheduleBtnMain.addEventListener('click', loadSchedule);

    // Admin controls
    if (isAdmin) {
        document.getElementById('setGameweekBtn').addEventListener('click', setGameweek);
        document.getElementById('fetchNowBtn').addEventListener('click', fetchStatsNow);
        document.getElementById('toggleAutoStatsBtn').addEventListener('click', toggleAutoStats);
        const loadScheduleBtn = document.getElementById('loadScheduleBtn');
        if (loadScheduleBtn) loadScheduleBtn.addEventListener('click', loadSchedule);
        document.getElementById('addToLeaderboardBtn').addEventListener('click', addToLeaderboard);
        document.getElementById('scheduleList').addEventListener('click', (e) => {
            const card = e.target.closest('.schedule-match-card');
            if (card && card.dataset.matchId) {
                selectMatch(card.dataset.matchId, card.dataset.matchName || '');
            }
        });
        loadAutoStatsStatus();
    }
    
    // Setup WebSocket for live updates
    setupWebSocket();
}

// Show specific view
function showView(viewName) {
    document.querySelectorAll('.fantasy-view').forEach(view => view.classList.add('hidden'));
    
    if (viewName === 'leaderboard') {
        document.getElementById('leaderboardView').classList.remove('hidden');
        loadLeaderboard(currentGameweek);
    } else if (viewName === 'myteam') {
        document.getElementById('myteamView').classList.remove('hidden');
        loadMyTeamPerformance(currentGameweek);
    } else if (viewName === 'schedule') {
        document.getElementById('scheduleView').classList.remove('hidden');
    } else if (viewName === 'admin' && isAdmin) {
        document.getElementById('adminView').classList.remove('hidden');
        loadAutoStatsStatus();
    }
}

// Load all sold players
async function loadAllSoldPlayers() {
    try {
        // Get all teams
        const teamsRes = await fetch(`${API_BASE}/api/teams`);
        const teams = await teamsRes.json();
        
        allSoldPlayers = [];
        
        // Get players for each team
        for (const team of teams) {
            const playersRes = await fetch(`${API_BASE}/api/team/${team.id}/players`);
            const data = await playersRes.json();
            
            data.players.forEach(player => {
                allSoldPlayers.push({
                    ...player,
                    teamId: team.id,
                    teamName: team.name
                });
            });
        }
        
        // Populate player dropdown for admin (if manual stats form exists)
        if (isAdmin) {
            const select = document.getElementById('statPlayerSelect');
            if (select) {
                select.innerHTML = '<option value="">Select Player</option>';
                allSoldPlayers.forEach(player => {
                    const option = document.createElement('option');
                    option.value = player.playerId;
                    option.textContent = `${player.playerName} (${player.position}) - ${player.teamName}`;
                    option.dataset.position = player.position;
                    option.dataset.playerName = player.playerName;
                    select.appendChild(option);
                });
            }
        }
    } catch (err) {
        console.error('Failed to load sold players:', err);
    }
}

// Load current gameweek
async function loadCurrentGameweek() {
    try {
        const response = await fetch(`${API_BASE}/api/fantasy/gameweek/current`);
        const data = await response.json();
        
        if (data.gameweek) {
            currentGameweek = data.gameweek;
            document.getElementById('gameweekInfo').textContent = `Gameweek ${data.gameweek}: ${data.status}`;
            
            // Update selectors
            document.getElementById('gameweekSelector').value = data.gameweek;
            document.getElementById('myteamGameweekSelector').value = data.gameweek;
        }
    } catch (err) {
        console.error('Failed to load current gameweek:', err);
    }
}

// Load leaderboard
async function loadLeaderboard(gameweek) {
    try {
        const content = document.getElementById('leaderboardContent');
        content.innerHTML = '<div class="loading-state">Loading leaderboard...</div>';
        
        const response = await fetch(`${API_BASE}/api/fantasy/leaderboard/${gameweek}`);
        const data = await response.json();
        
        if (data.leaderboard.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <h3>No data for Gameweek ${gameweek}</h3>
                    <p>Player stats haven't been entered yet</p>
                </div>
            `;
            return;
        }
        
        content.innerHTML = '';
        
        data.leaderboard.forEach((team, index) => {
            const div = document.createElement('div');
            div.className = `leaderboard-team rank-${index + 1}`;
            
            let playersHTML = '';
            if (team.players.length > 0) {
                playersHTML = '<div class="leaderboard-players">';
                team.players.forEach(player => {
                    if (player.points > 0) {
                        playersHTML += `
                            <div class="leaderboard-player">
                                <div class="leaderboard-player-name">${player.playerName}</div>
                                <div class="leaderboard-player-stats">
                                    ${player.runs > 0 ? `${player.runs} runs` : ''}
                                    ${player.wickets > 0 ? `${player.wickets} wkts` : ''}
                                    ${player.catches > 0 ? `${player.catches} catches` : ''}
                                </div>
                                <div class="leaderboard-player-points">${player.points} pts</div>
                            </div>
                        `;
                    }
                });
                playersHTML += '</div>';
            }
            
            div.innerHTML = `
                <div class="leaderboard-header">
                    <div class="leaderboard-rank">#${index + 1}</div>
                    <div class="leaderboard-team-name">${team.teamName}</div>
                    <div class="leaderboard-points">${team.totalPoints} pts</div>
                </div>
                ${playersHTML}
            `;
            
            content.appendChild(div);
        });
    } catch (err) {
        document.getElementById('leaderboardContent').innerHTML = 
            '<div class="empty-state"><h3>Failed to load leaderboard</h3></div>';
    }
}

// Load my team performance
async function loadMyTeamPerformance(gameweek) {
    try {
        const teamId = isAdmin ? 1 : currentTeam.id; // Admin defaults to team 1 for viewing
        
        const response = await fetch(`${API_BASE}/api/fantasy/team/${teamId}/gameweek/${gameweek}`);
        const data = await response.json();
        
        document.getElementById('myteamTotalPoints').textContent = data.totalPoints || 0;
        
        const playersDiv = document.getElementById('myteamPlayers');
        
        if (data.players.length === 0) {
            playersDiv.innerHTML = `
                <div class="empty-state">
                    <h3>No performance data for Gameweek ${gameweek}</h3>
                    <p>Stats haven't been entered yet</p>
                </div>
            `;
            return;
        }
        
        playersDiv.innerHTML = '';
        
        data.players.forEach(player => {
            const div = document.createElement('div');
            div.className = 'player-performance-card';
            
            div.innerHTML = `
                <div class="player-perf-header">
                    <div>
                        <div class="player-perf-name">${player.playerName}</div>
                        <span class="player-perf-position">${player.position}</span>
                    </div>
                </div>
                <div class="player-perf-points">${player.fantasyPoints} Points</div>
                <div class="player-perf-stats">
                    <div class="stat-item">
                        <span class="stat-label">Runs</span>
                        <span class="stat-value">${player.runs}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Wickets</span>
                        <span class="stat-value">${player.wickets}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Catches</span>
                        <span class="stat-value">${player.catches}</span>
                    </div>
                </div>
            `;
            
            playersDiv.appendChild(div);
        });
    } catch (err) {
        console.error('Failed to load team performance:', err);
    }
}

// Admin: Set gameweek
async function setGameweek() {
    const gameweek = parseInt(document.getElementById('gwNumber').value);
    const status = document.getElementById('gwStatus').value;
    
    if (!gameweek || gameweek < 1) {
        showToast('Invalid gameweek number', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/fantasy/gameweek`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gameweek,
                status,
                startDate: new Date().toISOString(),
                endDate: null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`Gameweek ${gameweek} set as ${status}`, 'success');
            await loadCurrentGameweek();
        }
    } catch (err) {
        showToast('Failed to set gameweek', 'error');
    }
}

// Admin: Calculate points preview (used only if manual stats form exists)
function calculatePreview() {
    const select = document.getElementById('statPlayerSelect');
    if (!select) return;
    const selectedOption = select.options[select.selectedIndex];
    
    if (!selectedOption.value) {
        showToast('Please select a player', 'error');
        return;
    }
    
    const position = selectedOption.dataset.position;
    
    const stats = {
        runs: parseInt(document.getElementById('statRuns').value) || 0,
        ballsFaced: parseInt(document.getElementById('statBalls').value) || 0,
        fours: parseInt(document.getElementById('statFours').value) || 0,
        sixes: parseInt(document.getElementById('statSixes').value) || 0,
        wickets: parseInt(document.getElementById('statWickets').value) || 0,
        oversBowled: parseFloat(document.getElementById('statOvers').value) || 0,
        runsConceded: parseInt(document.getElementById('statRunsConceded').value) || 0,
        maidens: parseInt(document.getElementById('statMaidens').value) || 0,
        catches: parseInt(document.getElementById('statCatches').value) || 0,
        stumpings: parseInt(document.getElementById('statStumpings').value) || 0,
        runOuts: parseInt(document.getElementById('statRunOuts').value) || 0
    };
    
    // Calculate strike rate and economy rate
    stats.strikeRate = stats.ballsFaced > 0 ? (stats.runs / stats.ballsFaced) * 100 : 0;
    stats.economyRate = stats.oversBowled > 0 ? (stats.runsConceded / stats.oversBowled) : 0;
    
    // Send to server for calculation
    calculatePointsOnServer(stats, position);
}

async function calculatePointsOnServer(stats, position) {
    try {
        // Calculate client-side first for preview
        let points = 0;
        
        // Batting
        points += (stats.runs || 0);
        points += (stats.fours || 0);
        points += (stats.sixes || 0) * 2;
        
        if (stats.runs >= 100) points += 16;
        else if (stats.runs >= 50) points += 8;
        else if (stats.runs >= 30) points += 4;
        
        // Bowling
        points += (stats.wickets || 0) * 25;
        if (stats.wickets >= 5) points += 16;
        else if (stats.wickets >= 4) points += 8;
        else if (stats.wickets >= 3) points += 4;
        
        points += (stats.maidens || 0) * 12;
        
        // Fielding
        points += (stats.catches || 0) * 8;
        points += (stats.stumpings || 0) * 12;
        points += (stats.runOuts || 0) * 6;
        
        // Economy/Strike rate bonuses
        if (stats.oversBowled >= 2 && stats.economyRate > 0) {
            if (stats.economyRate < 5) points += 6;
            else if (stats.economyRate <= 6) points += 4;
            else if (stats.economyRate >= 9 && stats.economyRate <= 10) points -= 2;
            else if (stats.economyRate > 11) points -= 4;
        }
        
        if (stats.ballsFaced >= 10 && stats.strikeRate > 0) {
            if (stats.strikeRate > 170) points += 6;
            else if (stats.strikeRate >= 150) points += 4;
            else if (stats.strikeRate < 50) points -= 4;
            else if (stats.strikeRate < 70) points -= 2;
        }
        
        document.getElementById('pointsPreview').classList.remove('hidden');
        document.getElementById('previewPoints').textContent = Math.round(points * 10) / 10;
    } catch (err) {
        showToast('Failed to calculate points', 'error');
    }
}

// Admin: Submit player stats (used only if manual stats form exists)
async function submitPlayerStats() {
    const matchIdEl = document.getElementById('matchId');
    const select = document.getElementById('statPlayerSelect');
    if (!matchIdEl || !select) return;
    const matchId = matchIdEl.value.trim();
    const gameweek = parseInt(document.getElementById('statGameweek').value);
    const selectedOption = select.options[select.selectedIndex];
    
    if (!matchId) {
        showToast('Please enter Match ID', 'error');
        return;
    }
    
    if (!selectedOption.value) {
        showToast('Please select a player', 'error');
        return;
    }
    
    const playerId = parseInt(selectedOption.value);
    const playerName = selectedOption.dataset.playerName;
    const position = selectedOption.dataset.position;
    
    const stats = {
        runs: parseInt(document.getElementById('statRuns').value) || 0,
        ballsFaced: parseInt(document.getElementById('statBalls').value) || 0,
        fours: parseInt(document.getElementById('statFours').value) || 0,
        sixes: parseInt(document.getElementById('statSixes').value) || 0,
        wickets: parseInt(document.getElementById('statWickets').value) || 0,
        oversBowled: parseFloat(document.getElementById('statOvers').value) || 0,
        runsConceded: parseInt(document.getElementById('statRunsConceded').value) || 0,
        maidens: parseInt(document.getElementById('statMaidens').value) || 0,
        catches: parseInt(document.getElementById('statCatches').value) || 0,
        stumpings: parseInt(document.getElementById('statStumpings').value) || 0,
        runOuts: parseInt(document.getElementById('statRunOuts').value) || 0
    };
    
    // Calculate derived stats
    stats.strikeRate = stats.ballsFaced > 0 ? (stats.runs / stats.ballsFaced) * 100 : 0;
    stats.economyRate = stats.oversBowled > 0 ? (stats.runsConceded / stats.oversBowled) : 0;
    
    try {
        const response = await fetch(`${API_BASE}/api/fantasy/performance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                matchId,
                gameweek,
                playerId,
                playerName,
                position,
                stats
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`Stats saved! ${playerName}: ${data.fantasyPoints} points`, 'success');
            clearStatsForm();
        } else {
            showToast('Failed to save stats', 'error');
        }
    } catch (err) {
        showToast('Failed to save stats', 'error');
    }
}

// Clear stats form (no-op if manual form was removed)
function clearStatsForm() {
    const sel = document.getElementById('statPlayerSelect');
    if (!sel) return;
    sel.value = '';
    const ids = ['statRuns', 'statBalls', 'statFours', 'statSixes', 'statWickets', 'statOvers', 'statRunsConceded', 'statMaidens', 'statCatches', 'statStumpings', 'statRunOuts'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = '0'; });
    const prev = document.getElementById('pointsPreview'); if (prev) prev.classList.add('hidden');
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// ========================================
// AUTO-STATS FUNCTIONS
// ========================================

// Load auto-stats service status
async function loadAutoStatsStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/autostats/status`);
        const data = await response.json();
        
        updateAutoStatsUI(data);
    } catch (err) {
        console.error('Failed to load auto-stats status:', err);
    }
}

// Update auto-stats UI
function updateAutoStatsUI(status) {
    const statusBadge = document.getElementById('autoStatsStatus');
    const apiKeyStatus = document.getElementById('apiKeyStatus');
    const toggleBtn = document.getElementById('toggleAutoStatsBtn');
    if (!statusBadge || !apiKeyStatus) return;

    if (status.enabled) {
        statusBadge.textContent = 'Enabled';
        statusBadge.className = 'status-badge status-enabled';
        if (toggleBtn) { toggleBtn.textContent = 'Disable'; toggleBtn.className = 'btn btn-danger'; }
    } else {
        statusBadge.textContent = 'Disabled';
        statusBadge.className = 'status-badge status-disabled';
        if (toggleBtn) { toggleBtn.textContent = 'Enable'; toggleBtn.className = 'btn btn-secondary'; }
    }

    const providerName = status.apiProvider || 'Cricketdata.org';
    apiKeyStatus.textContent = status.apiKeyConfigured ? `API: ✓ ${providerName}` : `API: ✗ ${providerName} (set CRICKETDATA_API_KEY)`;
    apiKeyStatus.style.color = '';
}

// Fetch stats now (manual trigger)
async function fetchStatsNow() {
    try {
        const btn = document.getElementById('fetchNowBtn');
        btn.disabled = true;
        btn.textContent = '⏳ Fetching...';
        
        const response = await fetch(`${API_BASE}/api/autostats/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Stats fetch started! Updates will appear automatically', 'success');
        }
        
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '🔄 Fetch Now';
        }, 3000);
    } catch (err) {
        showToast('Failed to trigger stats fetch', 'error');
        const btn = document.getElementById('fetchNowBtn');
        btn.disabled = false;
        btn.textContent = '🔄 Fetch Now';
    }
}

// Toggle auto-stats service
async function toggleAutoStats() {
    try {
        const response = await fetch(`${API_BASE}/api/autostats/status`);
        const currentStatus = await response.json();
        
        const newEnabled = !currentStatus.enabled;
        
        const toggleResponse = await fetch(`${API_BASE}/api/autostats/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newEnabled })
        });
        
        const data = await toggleResponse.json();
        
        if (data.success) {
            updateAutoStatsUI({ enabled: newEnabled, apiKeyConfigured: currentStatus.apiKeyConfigured });
            showToast(newEnabled ? 'Auto-stats enabled' : 'Auto-stats disabled', 'success');
        }
    } catch (err) {
        showToast('Failed to toggle auto-stats', 'error');
    }
}

// Load schedule and render match list (works from Schedule tab and Admin tab)
async function loadSchedule() {
    const season = (document.getElementById('scheduleSeasonMain') || document.getElementById('scheduleSeason'))?.value || '2025';
    const btnMain = document.getElementById('loadScheduleBtnMain');
    const btnAdmin = document.getElementById('loadScheduleBtn');
    const listMain = document.getElementById('scheduleListMain');
    const listAdmin = document.getElementById('scheduleList');

    const setLoading = (on) => {
        const text = on ? 'Loading...' : 'Load schedule';
        if (btnMain) { btnMain.disabled = on; btnMain.textContent = text; }
        if (btnAdmin) { btnAdmin.disabled = on; btnAdmin.textContent = text; }
        if (on) {
            const loadingHtml = '<p class="schedule-placeholder">Loading schedule...</p>';
            if (listMain) listMain.innerHTML = loadingHtml;
            if (listAdmin) listAdmin.innerHTML = loadingHtml;
        }
    };

    setLoading(true);

    try {
        const url = `${API_BASE}/api/autostats/matches?season=${encodeURIComponent(season)}&schedule=true`;
        const response = await fetch(url);
        let data;
        try {
            data = await response.json();
        } catch (_) {
            data = { success: false };
        }
        if (!response.ok) {
            data.success = false;
            data.matches = [];
        }

        const placeholderNoMatches = '<p class="schedule-placeholder">No IPL 2025 matches. Ensure Cricketdata.org API key (CRICKETDATA_API_KEY) is set and the series has matches.</p>';

        if (data.success && data.matches && data.matches.length > 0) {
            const matchesHtml = data.matches.map(m => `
                <button type="button" class="schedule-match-card" data-match-id="${m.id}" data-match-name="${escapeAttr(m.name || '')}">
                    <span class="match-card-name">${escapeHtml(m.name || `Match ${m.id}`)}</span>
                    <span class="match-card-meta">${escapeHtml(m.series || '')} · ${m.status || ''} ${m.matchEnded ? '· Completed' : ''}</span>
                </button>
            `).join('');
            if (listMain) listMain.innerHTML = matchesHtml;
            if (listAdmin) listAdmin.innerHTML = matchesHtml;
            showToast(`Loaded ${data.count} matches.`, 'success');
        } else {
            if (listMain) listMain.innerHTML = placeholderNoMatches;
            if (listAdmin) listAdmin.innerHTML = placeholderNoMatches;
            showToast('No matches found for this season', 'info');
        }
    } catch (err) {
        const failHtml = '<p class="schedule-placeholder">Failed to load schedule.</p>';
        if (listMain) listMain.innerHTML = failHtml;
        if (listAdmin) listAdmin.innerHTML = failHtml;
        showToast('Failed to load schedule', 'error');
    }

    setLoading(false);
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}
function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

// Select a match: fetch scorecard and show player stats (admin)
async function selectMatch(matchId, matchName) {
    selectedMatchId = matchId;
    selectedMatchName = matchName || `Match ${matchId}`;

    document.querySelectorAll('.schedule-match-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.matchId === matchId);
    });

        document.getElementById('matchDetailEmpty').classList.add('hidden');
    const content = document.getElementById('matchDetailContent');
    content.classList.remove('hidden');
    document.getElementById('matchDetailTitle').textContent = selectedMatchName;

    const tbodyAll = document.querySelector('#allPlayersTable tbody');
    const tbodyLeague = document.querySelector('#leaguePlayersTable tbody');

    tbodyAll.innerHTML = '<tr><td colspan="9">Loading...</td></tr>';
    tbodyLeague.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

    try {
        const url = `${API_BASE}/api/autostats/match/${encodeURIComponent(matchId)}/scorecard?matchName=${encodeURIComponent(selectedMatchName)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
            const errMsg = data.error || 'No scorecard';
            tbodyAll.innerHTML = '<tr><td colspan="9"><span class="scorecard-error">' + escapeHtml(errMsg) + '</span></td></tr>';
            tbodyLeague.innerHTML = '<tr><td colspan="7">No data</td></tr>';
            document.getElementById('addToLeaderboardBtn').disabled = true;
            return;
        }

        tbodyAll.innerHTML = (data.allPlayers || []).map(p => `
            <tr>
                <td>${escapeHtml(p.playerName)}</td>
                <td>${p.runs}</td>
                <td>${p.ballsFaced}</td>
                <td>${p.fours}</td>
                <td>${p.sixes}</td>
                <td>${p.wickets}</td>
                <td>${p.oversBowled}</td>
                <td>${p.runsConceded}</td>
                <td>${p.catches}</td>
            </tr>
        `).join('') || '<tr><td colspan="9">No player stats</td></tr>';

        tbodyLeague.innerHTML = (data.leaguePlayers || []).map(p => `
            <tr>
                <td>${escapeHtml(p.playerName)}</td>
                <td>${escapeHtml(p.teamName)}</td>
                <td>${escapeHtml(p.position)}</td>
                <td>${p.runs}</td>
                <td>${p.wickets}</td>
                <td>${p.catches}</td>
                <td><strong>${p.fantasyPoints}</strong></td>
            </tr>
        `).join('') || '<tr><td colspan="7">No league players in this match</td></tr>';

        document.getElementById('addToLeaderboardBtn').disabled = false;
    } catch (err) {
        tbodyAll.innerHTML = '<tr><td colspan="9">Error loading scorecard</td></tr>';
        tbodyLeague.innerHTML = '<tr><td colspan="7">Error</td></tr>';
        document.getElementById('addToLeaderboardBtn').disabled = true;
    }
}

// Single button: add current match to leaderboard (admin)
async function addToLeaderboard() {
    if (!selectedMatchId) {
        showToast('Select a match first', 'error');
        return;
    }
    const btn = document.getElementById('addToLeaderboardBtn');
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
        const response = await fetch(`${API_BASE}/api/autostats/test-match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ matchId: selectedMatchId })
        });
        const data = await response.json();
        if (data.success) {
            showToast('Match added to leaderboard. Points will update shortly.', 'success');
        } else {
            showToast('Failed to add to leaderboard', 'error');
        }
    } catch (err) {
        showToast('Failed to add to leaderboard', 'error');
    }
    btn.disabled = false;
    btn.textContent = '✓ Add to leaderboard';
}

// ========================================
// WEBSOCKET FOR LIVE UPDATES
// ========================================

let ws = null;

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('🔌 WebSocket connected for fantasy updates');
            
            // Register for updates
            ws.send(JSON.stringify({
                type: 'register',
                teamId: isAdmin ? 0 : currentTeam.id,
                teamName: isAdmin ? 'Admin' : currentTeam.name
            }));
        };
        
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (err) {
                console.error('Failed to parse WebSocket message:', err);
            }
        };
        
        ws.onclose = () => {
            console.log('🔌 WebSocket disconnected, reconnecting in 5s...');
            setTimeout(setupWebSocket, 5000);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    } catch (err) {
        console.error('Failed to setup WebSocket:', err);
    }
}

function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'auto_stats_update':
            handleAutoStatsUpdate(message);
            break;
            
        case 'match_processed':
            handleMatchProcessed(message);
            break;
            
        case 'performance_updated':
            // Refresh current view
            const activeView = document.querySelector('.fantasy-nav-btn.active')?.dataset.view;
            if (activeView === 'leaderboard') {
                loadLeaderboard(currentGameweek);
            } else if (activeView === 'myteam') {
                loadMyTeamPerformance(currentGameweek);
            }
            break;
    }
}

function handleAutoStatsUpdate(data) {
    console.log(`📊 Auto-update: ${data.playerName} (${data.teamName}) - ${data.fantasyPoints} pts`);
    
    // Show toast notification
    showToast(
        `${data.playerName} (${data.teamName}): ${data.fantasyPoints} pts - ${data.stats.runs}R ${data.stats.wickets}W`,
        'info'
    );
    
    // Refresh leaderboard if on that view
    const activeView = document.querySelector('.fantasy-nav-btn.active')?.dataset.view;
    if (activeView === 'leaderboard' && data.gameweek === currentGameweek) {
        setTimeout(() => loadLeaderboard(currentGameweek), 1000);
    }
}

function handleMatchProcessed(data) {
    console.log(`✅ Match processed: ${data.matchName} - ${data.playersUpdated} players updated`);
    
    showToast(
        `Match ${data.matchName} processed! ${data.playersUpdated} players updated`,
        'success'
    );
    
    // Refresh current view
    const activeView = document.querySelector('.fantasy-nav-btn.active')?.dataset.view;
    if (activeView === 'leaderboard' && data.gameweek === currentGameweek) {
        loadLeaderboard(currentGameweek);
    } else if (activeView === 'myteam' && data.gameweek === currentGameweek) {
        loadMyTeamPerformance(currentGameweek);
    }
}

// Initialize app
init();
