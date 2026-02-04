// Configuration
const API_BASE = window.location.origin;
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_BASE = `${WS_PROTOCOL}//${window.location.host}`;

// State
let currentTeam = null;
let isAdmin = false;
let ws = null;
let availablePlayers = [];
let allTeams = [];
let leftPanelView = 'players'; // 'players' or 'teams'

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const auctionScreen = document.getElementById('auctionScreen');
const loginForm = document.getElementById('loginForm');
const teamSelect = document.getElementById('teamSelect');
const teamInfo = document.getElementById('teamInfo');
const playersList = document.getElementById('playersList');
const positionFilter = document.getElementById('positionFilter');
const searchPlayer = document.getElementById('searchPlayer');
const noAuction = document.getElementById('noAuction');
const activeAuction = document.getElementById('activeAuction');
const viewTeamBtn = document.getElementById('viewTeamBtn');
const logoutBtn = document.getElementById('logoutBtn');
const myTeamModal = document.getElementById('myTeamModal');
const toast = document.getElementById('toast');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

// Initialize
async function init() {
    await loadTeams();
    setupEventListeners();
    
    // Initialize chat with empty state
    chatMessages.innerHTML = '<div class="chat-empty">Chat will appear here<br>Start the conversation!</div>';
    
    // Check for saved session
    const savedTeam = localStorage.getItem('currentTeam');
    const savedIsAdmin = localStorage.getItem('isAdmin');
    
    if (savedTeam) {
        currentTeam = JSON.parse(savedTeam);
        isAdmin = savedIsAdmin === 'true';
        showAuctionScreen();
        connectWebSocket();
        await loadAvailablePlayers();
        
        if (isAdmin) {
            populateAdminTeamSelect();
            // Show initialize button for admin
            const initBtn = document.getElementById('initializeAuctionBtn');
            if (initBtn) initBtn.classList.remove('hidden');
        }
    }
}

// Load teams for dropdown
async function loadTeams() {
    try {
        console.log('🔄 Loading teams from:', `${API_BASE}/api/teams`);
        const response = await fetch(`${API_BASE}/api/teams`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Handle both successful response and error fallback with teams
        if (data.error && data.teams) {
            console.warn('⚠️ Server returned fallback teams:', data.error);
            allTeams = data.teams;
        } else if (Array.isArray(data)) {
            allTeams = data;
        } else {
            throw new Error('Invalid response format');
        }
        
        console.log('✅ Teams loaded:', allTeams.length, 'teams');
        
        if (allTeams.length === 0) {
            throw new Error('No teams available');
        }
        
        teamSelect.innerHTML = '<option value="">Select Team</option>';
        
        // Add Admin option
        const adminOption = document.createElement('option');
        adminOption.value = 0;
        adminOption.textContent = 'Admin';
        teamSelect.appendChild(adminOption);
        
        allTeams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            teamSelect.appendChild(option);
            console.log(`  ✓ Added team: ${team.name} (ID: ${team.id}${team.shorthand ? `, ${team.shorthand}` : ''})`);
        });
        
        console.log('✅ Team dropdown populated with', allTeams.length, 'teams + Admin');
    } catch (err) {
        console.error('❌ Failed to load teams:', err);
        showToast('Failed to load teams: ' + err.message, 'error');
        
        // Fallback: Show error in dropdown with helpful link
        teamSelect.innerHTML = `
            <option value="">❌ Error: ${err.message}</option>
            <option value="" disabled>Please refresh or check health status</option>
        `;
    }
}

// Setup event listeners
function setupEventListeners() {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    
    // Fantasy league navigation
    const fantasyBtn = document.getElementById('fantasyLeagueBtn');
    if (fantasyBtn) {
        fantasyBtn.addEventListener('click', () => {
            window.location.href = '/fantasy.html';
        });
    }
    
    viewTeamBtn.addEventListener('click', () => showMyTeam());
    positionFilter.addEventListener('change', filterPlayers);
    searchPlayer.addEventListener('input', filterPlayers);
    
    // Left panel toggle
    document.getElementById('togglePlayers').addEventListener('click', () => switchLeftPanel('players'));
    document.getElementById('toggleTeams').addEventListener('click', () => switchLeftPanel('teams'));
    
    // Chat functionality
    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
    
    document.querySelector('.close-modal').addEventListener('click', () => {
        myTeamModal.classList.add('hidden');
    });
    
    myTeamModal.addEventListener('click', (e) => {
        if (e.target === myTeamModal) {
            myTeamModal.classList.add('hidden');
        }
    });
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    
    const teamId = parseInt(teamSelect.value);
    const password = document.getElementById('passwordInput').value;
    let teamName;
    
    if (teamId === 0) {
        teamName = 'Admin';
    } else {
        teamName = allTeams.find(t => t.id === teamId)?.name;
    }
    
    if (!teamName) {
        showToast('Please select a team', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamName, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentTeam = data.team;
            isAdmin = data.isAdmin || false;
            
            // Save session to localStorage
            localStorage.setItem('currentTeam', JSON.stringify(currentTeam));
            localStorage.setItem('isAdmin', isAdmin);
            
            console.log('✅ Login successful! currentTeam:', currentTeam);
            console.log('  Team ID:', currentTeam.id, 'Type:', typeof currentTeam.id);
            showAuctionScreen();
            connectWebSocket();
            await loadAvailablePlayers();
            
            if (isAdmin) {
                populateAdminTeamSelect();
            }
        } else {
            showToast(data.message || 'Invalid credentials', 'error');
        }
    } catch (err) {
        showToast('Login failed', 'error');
    }
}

// Handle logout
function handleLogout() {
    if (ws) {
        ws.close();
    }
    
    // Clear session
    localStorage.removeItem('currentTeam');
    localStorage.removeItem('isAdmin');
    
    currentTeam = null;
    isAdmin = false;
    loginScreen.classList.remove('hidden');
    auctionScreen.classList.add('hidden');
    loginForm.reset();
}

// Show auction screen
function showAuctionScreen() {
    loginScreen.classList.add('hidden');
    auctionScreen.classList.remove('hidden');
    
    if (isAdmin) {
        teamInfo.innerHTML = `
            <span style="color: #000; font-weight: bold;">
                👤 Admin Mode - Full Access
            </span>
        `;
        // Show admin team viewer and hide "View My Team" button
        const adminTeamViewer = document.getElementById('adminTeamViewer');
        adminTeamViewer.classList.remove('hidden');
        viewTeamBtn.style.display = 'none';
        
        // Populate with teams
        adminTeamViewer.innerHTML = '<option value="">View Team...</option>';
        allTeams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = `${team.name} (Budget: ₹${team.budget} Cr)`;
            adminTeamViewer.appendChild(option);
        });
    } else {
        teamInfo.innerHTML = `
            <span style="color: ${currentTeam.color}; font-weight: bold;">
                ${currentTeam.name}
            </span>
        `;
        document.getElementById('adminTeamViewer').classList.add('hidden');
        viewTeamBtn.style.display = 'inline-block';
    }
}

// Connect WebSocket
function connectWebSocket() {
    ws = new WebSocket(WS_BASE);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({
            type: 'register',
            teamId: currentTeam.id
        }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(() => {
            if (currentTeam) {
                connectWebSocket();
            }
        }, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'state':
            updateAuctionState(data.state);
            updateNominationInfo(data.state); // Update nomination display
            break;
        case 'auction_start':
            updateAuctionState(data.state);
            updateNominationInfo(data.state); // Update nomination display
            showToast(`Auction started for ${data.state.currentPlayer.name}`, 'info');
            loadAvailablePlayers();
            break;
        case 'bid_update':
            updateAuctionState(data.state);
            updateNominationInfo(data.state); // Update nomination display
            break;
        case 'team_out':
            updateAuctionState(data.state);
            updateNominationInfo(data.state); // Update nomination display
            break;
        case 'team_unmarked':
            updateAuctionState(data.state);
            updateNominationInfo(data.state); // Update nomination display
            showToast('Team marked back IN', 'info');
            break;
        case 'rtm_opportunity':
            showRTMPhase(data);
            break;
        case 'auction_complete':
            const rtmText = data.rtmUsed ? ' (RTM Used)' : '';
            showToast(
                `${data.player} sold to ${data.winner} for ₹${data.price} Cr${rtmText}!`,
                'success'
            );
            updateTeamsBudget(data.teams);
            loadAvailablePlayers();
            updateNominationInfo(data.state || auctionState); // Update nomination display
            setTimeout(() => {
                noAuction.classList.remove('hidden');
                activeAuction.classList.add('hidden');
                document.getElementById('rtmPhase').classList.add('hidden');
            }, 2000);
            break;
        case 'reset':
            updateAuctionState(data.state);
            loadAvailablePlayers();
            break;
        case 'chat':
            displayChatMessage(data);
            break;
        case 'chat_history':
            // Load previous chat messages
            data.messages.forEach(msg => displayChatMessage(msg));
            break;
        case 'timer_start':
            updateAuctionState(data.state);
            showToast('⏱️ Only one team remaining! Countdown started!', 'info');
            break;
        case 'timer_tick':
            updateTimerDisplay(data.state);
            break;
        case 'rtm_timer_start':
            updateRTMTimerDisplay(data.state);
            break;
        case 'rtm_timer_tick':
            updateRTMTimerDisplay(data.state);
            break;
        case 'nomination_order_set':
            showToast(data.message, 'success');
            updateTurnNotification(data.state);
            break;
        case 'turn_change':
            updateTurnNotification(data.state);
            showToast(`Next turn: ${getTeamName(data.state.currentTurnTeam)}`, 'info');
            break;
        case 'full_reset':
            showToast(data.message, 'success');
            // Reload the page to refresh all data
            setTimeout(() => {
                window.location.reload();
            }, 1500);
            break;
        case 'error':
            showToast(data.message || 'An error occurred', 'error');
            break;
    }
}

// Update nomination info display
function updateNominationInfo(state) {
    if (!state.nominationOrder || state.nominationOrder.length === 0) {
        // Hide nomination info if not initialized
        const nominationInfoElements = document.querySelectorAll('.nomination-info');
        nominationInfoElements.forEach(el => el.classList.add('hidden'));
        return;
    }
    
    // Show nomination info
    const nominationInfoElements = document.querySelectorAll('.nomination-info');
    nominationInfoElements.forEach(el => el.classList.remove('hidden'));
    
    // Get current and next team names
    const currentTeamId = state.currentTurnTeam;
    const currentIndex = state.currentTurnIndex || 0;
    const nextIndex = (currentIndex + 1) % state.nominationOrder.length;
    const nextTeamId = state.nominationOrder[nextIndex];
    
    const currentTeam = allTeams.find(t => t.id === currentTeamId);
    const nextTeam = allTeams.find(t => t.id === nextTeamId);
    
    // Update both sets of nomination displays (inactive and active auction)
    const currentNominatorEl = document.getElementById('currentNominator');
    const nextNominatorEl = document.getElementById('nextNominator');
    const currentNominatorActiveEl = document.getElementById('currentNominatorActive');
    const nextNominatorActiveEl = document.getElementById('nextNominatorActive');
    
    if (currentNominatorEl) currentNominatorEl.textContent = currentTeam ? currentTeam.name : '-';
    if (nextNominatorEl) nextNominatorEl.textContent = nextTeam ? nextTeam.name : '-';
    if (currentNominatorActiveEl) currentNominatorActiveEl.textContent = currentTeam ? currentTeam.name : '-';
    if (nextNominatorActiveEl) nextNominatorActiveEl.textContent = nextTeam ? nextTeam.name : '-';
}

// Update auction state
function updateAuctionState(state) {
    // Update nomination info
    updateNominationInfo(state);
    
    if (state.auctionActive && state.currentPlayer) {
        noAuction.classList.add('hidden');
        activeAuction.classList.remove('hidden');
        document.getElementById('rtmPhase').classList.add('hidden');
        
        // Show/hide timer
        const timerElement = document.getElementById('auctionTimer');
        const timerDisplay = document.getElementById('timerDisplay');
        if (state.timerActive) {
            timerElement.classList.remove('hidden');
            timerDisplay.textContent = state.timeRemaining;
        } else {
            timerElement.classList.add('hidden');
        }
        
        document.getElementById('currentPlayerName').textContent = state.currentPlayer.name;
        document.getElementById('currentPlayerPosition').textContent = state.currentPlayer.position;
        document.getElementById('currentBidAmount').textContent = `₹${state.currentBid} Cr`;
        
        // Display franchise badge if player has a franchise
        const franchiseBadge = document.getElementById('franchiseBadge');
        if (state.currentPlayer.franchiseShorthand && state.currentPlayer.franchiseShorthand !== 'N/A') {
            franchiseBadge.textContent = state.currentPlayer.franchiseShorthand;
            franchiseBadge.classList.remove('hidden');
        } else {
            franchiseBadge.classList.add('hidden');
        }
        
        const bidderTeam = allTeams.find(t => t.id === state.currentBidder);
        document.getElementById('currentBidder').textContent = 
            bidderTeam ? `Leading: ${bidderTeam.name}` : '';
        
        // Update bid buttons
        const bidButtons = document.querySelectorAll('.bid-btn');
        const myTeam = state.teams.find(t => t.id === currentTeam.id);
        const isOut = state.teamsOut.includes(currentTeam.id);
        const isCurrentBidder = state.currentBidder === currentTeam.id;
        
        bidButtons.forEach(btn => {
            const increment = parseFloat(btn.dataset.increment);
            const newBid = state.currentBid + increment;
            // Disable if: out, insufficient budget, admin, or already highest bidder
            btn.disabled = isAdmin || isOut || !myTeam || newBid > myTeam.budget || isCurrentBidder;
        });
        
        // Update out button
        const outBtn = document.getElementById('markOutBtn');
        if (isAdmin) {
            outBtn.style.display = 'none';
        } else {
            outBtn.style.display = 'block';
            if (isOut) {
                outBtn.textContent = 'Marked Out';
                outBtn.classList.add('marked');
                outBtn.disabled = true;
            } else {
                outBtn.textContent = 'Mark Out';
                outBtn.classList.remove('marked');
                outBtn.disabled = false;
            }
        }
        
        // Show/hide admin controls
        const adminControls = document.getElementById('adminControls');
        if (isAdmin) {
            adminControls.classList.remove('hidden');
            renderAdminTeamOutButtons(state);
        } else {
            adminControls.classList.add('hidden');
        }
        
        // Update teams status
        updateTeamsStatus(state);
    } else {
        noAuction.classList.remove('hidden');
        activeAuction.classList.add('hidden');
        document.getElementById('rtmPhase').classList.add('hidden');
        
        // Show/hide admin controls in no-auction view
        const adminControlsNoAuction = document.getElementById('adminControlsNoAuction');
        if (adminControlsNoAuction && isAdmin) {
            adminControlsNoAuction.classList.remove('hidden');
        } else if (adminControlsNoAuction) {
            adminControlsNoAuction.classList.add('hidden');
        }
    }
    
    // Update turn notification
    updateTurnNotification(state);
}

// Update teams status in auction
function updateTeamsStatus(state) {
    const statusList = document.getElementById('teamsStatusList');
    statusList.innerHTML = '';
    
    allTeams.forEach(team => {
        const div = document.createElement('div');
        div.className = 'team-status-item';
        
        if (state.teamsOut.includes(team.id)) {
            div.classList.add('out');
        }
        if (state.currentBidder === team.id) {
            div.classList.add('current-bidder');
        }
        
        const teamBudget = state.teams.find(t => t.id === team.id);
        
        div.innerHTML = `
            <span style="color: ${team.color}; font-weight: bold;">${team.name}</span>
            <span>₹${teamBudget ? teamBudget.budget : team.budget} Cr</span>
        `;
        
        statusList.appendChild(div);
    });
}

// Load available players
async function loadAvailablePlayers() {
    try {
        const response = await fetch(`${API_BASE}/api/players/available`);
        availablePlayers = await response.json();
        filterPlayers();
    } catch (err) {
        showToast('Failed to load players', 'error');
    }
}

// Filter players
function filterPlayers() {
    const position = positionFilter.value;
    const search = searchPlayer.value.toLowerCase();
    
    const filtered = availablePlayers.filter(player => {
        const matchesPosition = !position || player.position === position;
        const matchesSearch = !search || player.name.toLowerCase().includes(search);
        return matchesPosition && matchesSearch;
    });
    
    displayPlayers(filtered);
}

// Display players
function displayPlayers(players) {
    playersList.innerHTML = '';
    
    if (players.length === 0) {
        playersList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No players found</div>';
        return;
    }
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        
        // Get franchise shorthand
        const franchise = allTeams.find(t => t.id === player.franchiseId);
        const franchiseBadge = franchise && franchise.shorthand ? 
            `<span class="player-franchise-badge">${franchise.shorthand}</span>` : '';
        
        div.innerHTML = `
            <h3>${player.name} ${franchiseBadge}</h3>
            <div class="position">${player.position}</div>
            <div class="base-price">Base: ₹${player.basePrice} Cr</div>
        `;
        div.addEventListener('click', () => nominatePlayer(player));
        playersList.appendChild(div);
    });
}

// Nominate player
async function nominatePlayer(player) {
    try {
        // Block admin from nominating (admin is for control only)
        if (isAdmin) {
            showToast('Admin cannot nominate players. Only teams on their turn can nominate.', 'error');
            return;
        }
        
        const response = await fetch(`${API_BASE}/api/auction/nominate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: player.id,
                teamId: currentTeam.id
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`${player.name} nominated for auction`, 'success');
        } else {
            showToast(data.error || 'Failed to nominate player', 'error');
        }
    } catch (err) {
        showToast('Failed to nominate player', 'error');
    }
}

// Place bid
async function placeBid(increment) {
    try {
        // Validate squad before bidding
        const validation = await validateBid();
        if (!validation.canBid) {
            showToast(validation.message, 'error');
            return;
        }
        
        const response = await fetch(`${API_BASE}/api/auction/bid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teamId: currentTeam.id,
                increment: increment
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showToast(data.error || 'Failed to place bid', 'error');
        }
    } catch (err) {
        showToast('Failed to place bid', 'error');
    }
}

// Validate if team can bid
async function validateBid() {
    try {
        const response = await fetch(`${API_BASE}/api/team/${currentTeam.id}/players`);
        const data = await response.json();
        
        const squadStatus = data.squadStatus;
        
        // Check if squad is full
        if (squadStatus.atMaximum) {
            return {
                canBid: false,
                message: 'Cannot buy more players - Maximum 18 players reached!'
            };
        }
        
        // Check overseas quota
        if (auctionState.currentPlayer && auctionState.currentPlayer.overseas) {
            if (data.overseasCount >= 10) {
                return {
                    canBid: false,
                    message: 'Cannot bid on overseas player - Maximum 10 overseas players limit reached!'
                };
            }
        }
        
        // Check if approaching maximum without meeting minimums
        if (data.totalPlayers >= 16) {
            const unmetRequirements = [];
            Object.keys(squadStatus.requirements).forEach(position => {
                const req = squadStatus.requirements[position];
                if (!req.met) {
                    unmetRequirements.push(`${position} (need ${req.needed})`);
                }
            });
            
            if (unmetRequirements.length > 0 && data.totalPlayers >= 17) {
                return {
                    canBid: false,
                    message: `You must complete minimum requirements first: ${unmetRequirements.join(', ')}`
                };
            }
        }
        
        return { canBid: true };
    } catch (err) {
        return { canBid: true }; // Allow bid if validation fails
    }
}

// Mark out
async function markOut() {
    try {
        // Validate squad can afford to pass
        const validation = await validateMarkOut();
        if (!validation.canMarkOut) {
            const confirm = window.confirm(`${validation.message}\n\nAre you sure you want to mark out?`);
            if (!confirm) return;
        }
        
        const response = await fetch(`${API_BASE}/api/auction/out`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teamId: currentTeam.id
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Marked out of auction', 'info');
        } else {
            showToast(data.error || 'Failed to mark out', 'error');
        }
    } catch (err) {
        showToast('Failed to mark out', 'error');
    }
}

// Validate if team can mark out
async function validateMarkOut() {
    try {
        const response = await fetch(`${API_BASE}/api/team/${currentTeam.id}/players`);
        const data = await response.json();
        
        const squadStatus = data.squadStatus;
        
        // Check if close to minimum without meeting requirements
        if (data.totalPlayers < 16) {
            const playersNeeded = 16 - data.totalPlayers;
            const budgetNeeded = playersNeeded * 0.5;
            
            if (data.budget < budgetNeeded + 1) {
                return {
                    canMarkOut: false,
                    message: `Warning: You may not have enough budget to complete minimum 16 players!`
                };
            }
        }
        
        // Warn if missing minimum requirements
        const unmetRequirements = [];
        Object.keys(squadStatus.requirements).forEach(position => {
            const req = squadStatus.requirements[position];
            if (!req.met) {
                unmetRequirements.push(`${position} (need ${req.needed})`);
            }
        });
        
        if (unmetRequirements.length > 0) {
            return {
                canMarkOut: false,
                message: `Warning: Missing required positions - ${unmetRequirements.join(', ')}`
            };
        }
        
        return { canMarkOut: true };
    } catch (err) {
        return { canMarkOut: true }; // Allow mark out if validation fails
    }
}

// Update teams budget display (called after auction completes)
function updateTeamsBudget(teams) {
    // Update local teams array with latest budget data
    teams.forEach(updatedTeam => {
        const team = allTeams.find(t => t.id === updatedTeam.id);
        if (team) {
            team.budget = updatedTeam.budget;
        }
    });
    
    // If left panel is showing "All Teams" view, refresh it
    if (leftPanelView === 'teams') {
        displayAllTeams();
    }
    
    // Update admin team viewer dropdown if admin is logged in
    if (isAdmin) {
        const adminTeamViewer = document.getElementById('adminTeamViewer');
        const currentValue = adminTeamViewer.value;
        adminTeamViewer.innerHTML = '<option value="">View Team...</option>';
        teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = `${team.name} (Budget: ₹${team.budget} Cr)`;
            adminTeamViewer.appendChild(option);
        });
        adminTeamViewer.value = currentValue;
    }
}

// Show my team
async function showMyTeam(teamIdOverride = null) {
    try {
        console.log('🔍 showMyTeam called with override:', teamIdOverride);
        console.log('  currentTeam:', currentTeam);
        const teamId = teamIdOverride || currentTeam.id;
        console.log('📋 Fetching team players for team ID:', teamId, 'Type:', typeof teamId);
        const url = `${API_BASE}/api/team/${teamId}/players`;
        console.log('  URL:', url);
        const response = await fetch(url);
        const data = await response.json();
        console.log('✅ Received data:', data);
        
        // Find team info
        let teamInfo = currentTeam;
        if (teamIdOverride) {
            teamInfo = allTeams.find(t => t.id === teamIdOverride) || currentTeam;
        }
        
        console.log('Team info:', teamInfo);
        
        const budgetInfo = document.getElementById('myTeamBudget');
        const squadStatus = data.squadStatus || {};
        const requirements = squadStatus.requirements || {};
        
        // Create position breakdown HTML
        let positionHTML = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px;">';
        ['Wicket-keeper', 'Batsman', 'Bowler', 'All-rounder'].forEach(position => {
            const req = requirements[position] || { current: 0, minimum: 0, met: false };
            const statusColor = req.met ? '#28a745' : (req.needed > 0 ? '#dc3545' : '#ffc107');
            const statusIcon = req.met ? '✓' : (req.needed > 0 ? '!' : '-');
            positionHTML += `
                <div style="background: rgba(255,255,255,0.2); padding: 8px; border-radius: 6px;">
                    <div style="font-size: 0.85rem; opacity: 0.9;">${position}</div>
                    <div style="font-size: 1.1rem; font-weight: bold;">
                        <span style="color: ${statusColor};">${statusIcon}</span>
                        ${req.current}/${req.minimum}
                        ${req.needed > 0 ? ` <span style="font-size: 0.8rem; color: #dc3545;">(need ${req.needed})</span>` : ''}
                    </div>
                </div>
            `;
        });
        positionHTML += '</div>';
        
        budgetInfo.innerHTML = `
            <h3>${teamInfo.name}</h3>
            <div class="budget">Budget: ₹${data.budget} Cr</div>
            <div style="margin-top: 10px; opacity: 0.9; display: flex; justify-content: space-between;">
                <span>Players: ${data.totalPlayers || data.players.length}/18</span>
                <span>Spent: ₹${(100 - data.budget).toFixed(1)} Cr</span>
            </div>
            <div style="margin-top: 10px; opacity: 0.9; display: flex; justify-content: space-between;">
                <span>Overseas: ${data.overseasCount || 0}/10</span>
                <span>Indian: ${(data.totalPlayers || 0) - (data.overseasCount || 0)}</span>
            </div>
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.3);">
                <strong>Max Bid: ₹${data.maxBid || data.budget} Cr</strong>
                <div style="font-size: 0.8rem; opacity: 0.8; margin-top: 3px;">
                    (Based on 16 player minimum)
                </div>
            </div>
            ${positionHTML}
            ${squadStatus.atMaximum ? '<div style="margin-top: 10px; padding: 8px; background: #dc3545; border-radius: 6px; font-size: 0.9rem;">Squad Full (18 players)</div>' : ''}
            ${!squadStatus.meetsMinimum && data.totalPlayers >= 14 ? '<div style="margin-top: 10px; padding: 8px; background: #ffc107; color: #000; border-radius: 6px; font-size: 0.9rem;">Complete minimum requirements!</div>' : ''}
        `;
        
        const playersDiv = document.getElementById('myTeamPlayers');
        
        if (data.players.length === 0) {
            console.log('No players found');
            playersDiv.innerHTML = '<div class="empty-team">No players yet. Start bidding!</div>';
        } else {
            console.log(`✅ Displaying ${data.players.length} players`);
            playersDiv.innerHTML = '';
            data.players.forEach(player => {
                console.log('  Adding player:', player.playerName);
                const div = document.createElement('div');
                div.className = 'my-player-card';
                div.innerHTML = `
                    <h4>${player.playerName}</h4>
                    <div class="details">
                        <span>${player.position}</span>
                        <span class="price">₹${player.finalPrice} Cr</span>
                    </div>
                `;
                playersDiv.appendChild(div);
            });
        }
        
        myTeamModal.classList.remove('hidden');
    } catch (err) {
        showToast('Failed to load team', 'error');
    }
}

// Show toast notification
function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Setup bid button listeners
activeAuction.addEventListener('click', (e) => {
    if (e.target.classList.contains('bid-btn')) {
        const increment = parseFloat(e.target.dataset.increment);
        placeBid(increment);
    }
});

document.getElementById('markOutBtn').addEventListener('click', markOut);

// RTM Phase
function showRTMPhase(data) {
    noAuction.classList.add('hidden');
    activeAuction.classList.remove('hidden');
    document.getElementById('rtmPhase').classList.remove('hidden');
    
    const rtmMessage = document.getElementById('rtmMessage');
    rtmMessage.textContent = `${data.franchiseTeam} has the Right to Match for ${data.player}. Current bid: ₹${data.price} Cr by ${data.winningTeam}`;
    
    const useRTMBtn = document.getElementById('useRTMBtn');
    const declineRTMBtn = document.getElementById('declineRTMBtn');
    
    // Only show buttons for eligible team
    if (currentTeam.id === data.state.rtmEligibleTeam) {
        useRTMBtn.style.display = 'inline-block';
        declineRTMBtn.style.display = 'inline-block';
    } else {
        useRTMBtn.style.display = 'none';
        declineRTMBtn.style.display = 'none';
    }
}

// Use RTM
async function useRTM(useIt) {
    try {
        const response = await fetch(`${API_BASE}/api/auction/rtm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teamId: currentTeam.id,
                useRTM: useIt
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showToast(data.error || 'RTM action failed', 'error');
        }
    } catch (err) {
        showToast('RTM action failed', 'error');
    }
}

document.getElementById('useRTMBtn').addEventListener('click', () => useRTM(true));
document.getElementById('declineRTMBtn').addEventListener('click', () => useRTM(false));

// Admin Functions
function populateAdminTeamSelect() {
    const select = document.getElementById('adminTeamSelect');
    select.innerHTML = '<option value="">Select Team to Award</option>';
    allTeams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = team.name;
        select.appendChild(option);
    });
}

async function adminCompleteAuction() {
    const teamId = parseInt(document.getElementById('adminTeamSelect').value);
    const customPrice = parseFloat(document.getElementById('adminPriceInput').value) || 0.5;
    
    if (!teamId) {
        showToast('Please select a team', 'error');
        return;
    }
    
    if (customPrice < 0.5) {
        showToast('Price must be at least ₹0.5 Cr', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/admin/complete-auction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId, customPrice })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`Player sold for ₹${customPrice} Cr!`, 'success');
            document.getElementById('adminTeamSelect').value = '';
            document.getElementById('adminPriceInput').value = '0.5';
        } else {
            showToast(data.error || 'Failed to complete auction', 'error');
        }
    } catch (err) {
        showToast('Failed to complete auction', 'error');
    }
}

// Admin reset auction
function adminResetAuction() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected to server', 'error');
        return;
    }
    
    if (confirm('Are you sure you want to reset the current auction? This will clear all bids and teams out status.')) {
        ws.send(JSON.stringify({
            type: 'admin_reset_auction'
        }));
        showToast('Auction reset!', 'success');
    }
}

// Admin full reset
function adminFullReset() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected to server', 'error');
        return;
    }
    
    const confirmMessage = 'WARNING: This will DELETE ALL SOLD PLAYERS and reset ALL TEAM BUDGETS to ₹100 Cr!\n\n' +
                          'This action cannot be undone!\n\n' +
                          'Are you absolutely sure you want to do a FULL RESET?';
    
    if (confirm(confirmMessage)) {
        // Double confirmation for destructive action
        if (confirm('FINAL CONFIRMATION: Delete all auction data and start fresh?')) {
            ws.send(JSON.stringify({
                type: 'admin_full_reset'
            }));
            showToast('Full reset in progress...', 'info');
        }
    }
}

// Admin download Excel file
function adminDownloadExcel() {
    if (!isAdmin) {
        showToast('Admin access required', 'error');
        return;
    }
    
    // Create a link and trigger download
    const link = document.createElement('a');
    link.href = `${API_BASE}/api/admin/download-excel`;
    link.download = 'auction_data.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Downloading Excel file...', 'success');
}

// Admin mark team out
function adminMarkTeamOut(teamId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected to server', 'error');
        return;
    }
    
    console.log('🔴 Admin marking team OUT:', teamId);
    ws.send(JSON.stringify({
        type: 'admin_mark_team_out',
        teamId: teamId
    }));
}

// Admin unmark team (mark back in)
function adminUnmarkTeamOut(teamId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected to server', 'error');
        return;
    }
    
    console.log('🟢 Admin marking team back IN:', teamId);
    ws.send(JSON.stringify({
        type: 'admin_unmark_team_out',
        teamId: teamId
    }));
}

// Render admin team out buttons
function renderAdminTeamOutButtons(state) {
    const container = document.getElementById('adminTeamOutButtons');
    container.innerHTML = '';
    
    state.teams.forEach(team => {
        const isOut = state.teamsOut.includes(team.id);
        const isCurrentBidder = state.currentBidder === team.id;
        
        const btn = document.createElement('button');
        btn.className = `admin-team-out-btn ${isOut ? 'marked-out' : ''}`;
        
        // Show current bidder badge
        if (isCurrentBidder && !isOut) {
            btn.textContent = `${team.name} 👑 (Current Bid)`;
            btn.title = 'Cannot mark out - has current highest bid';
        } else {
            btn.textContent = isOut ? `${team.name} (OUT)` : team.name;
        }
        
        // Toggle functionality
        btn.onclick = () => {
            if (isOut) {
                // Unmark (mark back in)
                adminUnmarkTeamOut(team.id);
            } else {
                // Mark out (only if not current bidder)
                if (isCurrentBidder) {
                    showToast('Cannot mark out the team with the current highest bid!', 'error');
                } else {
                    adminMarkTeamOut(team.id);
                }
            }
        };
        
        container.appendChild(btn);
    });
}

document.getElementById('adminCompleteBtn').addEventListener('click', adminCompleteAuction);

// Admin reset auction
document.getElementById('adminResetBtn').addEventListener('click', adminResetAuction);

// Admin full reset
document.getElementById('adminFullResetBtn').addEventListener('click', adminFullReset);

// Admin download Excel
document.getElementById('adminDownloadBtn').addEventListener('click', adminDownloadExcel);

// Admin controls in no-auction view (duplicate buttons)
const adminFullResetBtnNoAuction = document.getElementById('adminFullResetBtnNoAuction');
const adminDownloadBtnNoAuction = document.getElementById('adminDownloadBtnNoAuction');
if (adminFullResetBtnNoAuction) {
    adminFullResetBtnNoAuction.addEventListener('click', adminFullReset);
}
if (adminDownloadBtnNoAuction) {
    adminDownloadBtnNoAuction.addEventListener('click', adminDownloadExcel);
}

// Admin team viewer
document.getElementById('adminTeamViewer').addEventListener('change', (e) => {
    const teamId = parseInt(e.target.value);
    if (teamId) {
        showMyTeam(teamId);
        e.target.value = ''; // Reset dropdown
    }
});

// Left panel switcher
function switchLeftPanel(view) {
    leftPanelView = view;
    
    const togglePlayers = document.getElementById('togglePlayers');
    const toggleTeams = document.getElementById('toggleTeams');
    const playersList = document.getElementById('playersList');
    const teamsList = document.getElementById('teamsList');
    const playerFilters = document.getElementById('playerFilters');
    
    if (view === 'players') {
        togglePlayers.classList.add('active');
        toggleTeams.classList.remove('active');
        playersList.classList.remove('hidden');
        teamsList.classList.add('hidden');
        playerFilters.classList.remove('hidden');
        filterPlayers();
    } else {
        toggleTeams.classList.add('active');
        togglePlayers.classList.remove('active');
        playersList.classList.add('hidden');
        teamsList.classList.remove('hidden');
        playerFilters.classList.add('hidden');
        displayAllTeams();
    }
}

// Display all teams in left panel
async function displayAllTeams() {
    const teamsList = document.getElementById('teamsList');
    teamsList.innerHTML = '<div style="padding: 10px; text-align: center; color: #999;">Loading teams...</div>';
    
    try {
        console.log('📋 Fetching teams from:', `${API_BASE}/api/teams/detailed`);
        const response = await fetch(`${API_BASE}/api/teams/detailed`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const teamsData = await response.json();
        console.log('✅ Teams loaded:', teamsData.length, 'teams');
        
        if (!Array.isArray(teamsData) || teamsData.length === 0) {
            throw new Error('No teams data received');
        }
        
        teamsList.innerHTML = '';
        
        teamsData.forEach(team => {
            const div = document.createElement('div');
            div.className = 'team-card';
            div.style.borderLeftColor = team.color;
            div.innerHTML = `
                <h3 style="color: ${team.color};">${team.name}</h3>
                <div class="team-card-info">
                    <span class="team-card-players">Players: ${team.playerCount}</span>
                    <span class="team-card-budget">₹${team.budget} Cr</span>
                </div>
            `;
            div.addEventListener('click', () => showMyTeam(team.id));
            teamsList.appendChild(div);
        });
    } catch (err) {
        console.error('❌ Failed to load teams:', err);
        teamsList.innerHTML = `<div style="padding: 20px; text-align: center; color: #dc3545;">
            Failed to load teams<br>
            <small style="color: #999;">${err.message}</small>
        </div>`;
    }
}

// Timer Functions
function updateTimerDisplay(state) {
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay && state.timerActive) {
        timerDisplay.textContent = state.timeRemaining;
        
        // Add visual warning when time is running low
        const timerElement = document.getElementById('auctionTimer');
        if (state.timeRemaining <= 10) {
            timerElement.style.borderColor = 'rgba(255, 59, 48, 0.8)';
            timerElement.style.background = 'rgba(255, 59, 48, 0.15)';
        } else {
            timerElement.style.borderColor = 'rgba(255, 255, 255, 0.4)';
            timerElement.style.background = 'rgba(255, 255, 255, 0.2)';
        }
    }
}

function updateRTMTimerDisplay(state) {
    const rtmTimerDisplay = document.getElementById('rtmTimerDisplay');
    if (rtmTimerDisplay && state.rtmTimerActive) {
        rtmTimerDisplay.textContent = state.rtmTimeRemaining;
        
        // Add visual warning when time is running low
        const rtmTimer = document.getElementById('rtmTimer');
        if (state.rtmTimeRemaining <= 10) {
            rtmTimer.style.borderColor = 'rgba(255, 59, 48, 0.8)';
            rtmTimer.style.background = 'rgba(255, 59, 48, 0.2)';
        } else {
            rtmTimer.style.borderColor = 'rgba(255, 255, 255, 0.4)';
            rtmTimer.style.background = 'rgba(255, 255, 255, 0.2)';
        }
    }
}

// Chat Functions
function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'chat',
        message: message,
        teamId: currentTeam.id,
        teamName: isAdmin ? 'Admin' : currentTeam.name,
        timestamp: new Date().toISOString()
    }));
    
    chatInput.value = '';
}

function displayChatMessage(data) {
    const messageDiv = document.createElement('div');
    const isOwnMessage = data.teamId === currentTeam.id;
    messageDiv.className = `chat-message ${isOwnMessage ? 'own-message' : 'other-message'}`;
    
    const time = new Date(data.timestamp).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    messageDiv.innerHTML = `
        <div class="chat-message-header">${data.teamName}</div>
        <div class="chat-message-text">${escapeHtml(data.message)}</div>
        <div class="chat-message-time">${time}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Remove empty state if it exists
    const emptyState = chatMessages.querySelector('.chat-empty');
    if (emptyState) {
        emptyState.remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Turn-based nomination functions
function getTeamName(teamId) {
    const team = allTeams.find(t => t.id === teamId);
    return team ? team.name : 'Unknown Team';
}

function updateTurnNotification(state) {
    const turnNotif = document.getElementById('turnNotification');
    const activeTurnNotif = document.getElementById('activeTurnNotification');
    
    if (!state.nominationOrder || state.nominationOrder.length === 0) {
        if (turnNotif) turnNotif.classList.add('hidden');
        if (activeTurnNotif) activeTurnNotif.classList.add('hidden');
        
        // Show initialize button for admin
        if (isAdmin) {
            const initBtn = document.getElementById('initializeAuctionBtn');
            if (initBtn) initBtn.classList.remove('hidden');
        }
        return;
    }
    
    // Hide initialize button once order is set
    const initBtn = document.getElementById('initializeAuctionBtn');
    if (initBtn) initBtn.classList.add('hidden');
    
    const currentTurnTeamName = getTeamName(state.currentTurnTeam);
    const isYourTurn = state.currentTurnTeam === currentTeam.id && !isAdmin; // Admin never has turn
    
    // Admin should NEVER see "your turn" notification - always hide for admin
    if (isAdmin) {
        if (turnNotif) turnNotif.classList.add('hidden');
        if (activeTurnNotif) activeTurnNotif.classList.add('hidden');
        // Admin can't nominate - only teams on their turn
        updatePlayerNominationUI(false);
        return;
    }
    
    const message = isYourTurn 
        ? `Your turn to nominate!` 
        : `Waiting for ${currentTurnTeamName} to nominate`;
    
    const className = isYourTurn ? 'your-turn' : 'not-your-turn';
    
    if (turnNotif && !state.auctionActive) {
        turnNotif.innerHTML = message;
        turnNotif.className = `turn-notification ${className}`;
        turnNotif.classList.remove('hidden');
    }
    
    if (activeTurnNotif && state.auctionActive) {
        activeTurnNotif.classList.add('hidden');
    } else if (activeTurnNotif && !state.auctionActive) {
        activeTurnNotif.innerHTML = message;
        activeTurnNotif.className = `turn-notification ${className}`;
        activeTurnNotif.classList.remove('hidden');
    }
    
    // Update player nomination UI based on turn
    updatePlayerNominationUI(isYourTurn);
}

function updatePlayerNominationUI(canNominate) {
    const playerItems = document.querySelectorAll('.player-item');
    playerItems.forEach(item => {
        // Only allow nomination if it's your turn (never for admin in non-admin mode)
        if (!canNominate) {
            item.style.opacity = '0.5';
            item.style.cursor = 'not-allowed';
            item.style.pointerEvents = 'none';
        } else {
            item.style.opacity = '1';
            item.style.cursor = 'pointer';
            item.style.pointerEvents = 'auto';
        }
    });
}

async function initializeAuction() {
    try {
        const response = await fetch(`${API_BASE}/api/auction/initialize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Auction order set! Teams can now nominate in turns.', 'success');
        } else {
            showToast(data.error || 'Failed to initialize auction', 'error');
        }
    } catch (err) {
        showToast('Failed to initialize auction', 'error');
    }
}

// Add initialize button event listener
document.addEventListener('DOMContentLoaded', () => {
    const initBtn = document.getElementById('initializeAuctionBtn');
    if (initBtn) {
        initBtn.addEventListener('click', initializeAuction);
    }
});

// Initialize app
init();

