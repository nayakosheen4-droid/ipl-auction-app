// Configuration
const API_BASE = window.location.origin;
const WS_BASE = `ws://${window.location.host}`;

// State
let currentTeam = null;
let isAdmin = false;
let ws = null;
let availablePlayers = [];
let allTeams = [];

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
const teamsBudget = document.getElementById('teamsBudget');
const toast = document.getElementById('toast');

// Initialize
async function init() {
    await loadTeams();
    setupEventListeners();
}

// Load teams for dropdown
async function loadTeams() {
    try {
        const response = await fetch(`${API_BASE}/api/teams`);
        allTeams = await response.json();
        
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
        });
    } catch (err) {
        showToast('Failed to load teams', 'error');
    }
}

// Setup event listeners
function setupEventListeners() {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    viewTeamBtn.addEventListener('click', showMyTeam);
    positionFilter.addEventListener('change', filterPlayers);
    searchPlayer.addEventListener('input', filterPlayers);
    
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
            console.log('✅ Login successful! currentTeam:', currentTeam);
            console.log('  Team ID:', currentTeam.id, 'Type:', typeof currentTeam.id);
            showAuctionScreen();
            connectWebSocket();
            await loadAvailablePlayers();
            await loadTeamsBudget();
            
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
            break;
        case 'auction_start':
            updateAuctionState(data.state);
            showToast(`Auction started for ${data.state.currentPlayer.name}`, 'info');
            loadAvailablePlayers();
            break;
        case 'bid_update':
            updateAuctionState(data.state);
            break;
        case 'team_out':
            updateAuctionState(data.state);
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
            setTimeout(() => {
                noAuction.classList.remove('hidden');
                activeAuction.classList.add('hidden');
                document.getElementById('rtmPhase').classList.add('hidden');
            }, 2000);
            break;
        case 'reset':
            updateAuctionState(data.state);
            loadAvailablePlayers();
            loadTeamsBudget();
            break;
    }
}

// Update auction state
function updateAuctionState(state) {
    if (state.auctionActive && state.currentPlayer) {
        noAuction.classList.add('hidden');
        activeAuction.classList.remove('hidden');
        document.getElementById('rtmPhase').classList.add('hidden');
        
        document.getElementById('currentPlayerName').textContent = state.currentPlayer.name;
        document.getElementById('currentPlayerPosition').textContent = state.currentPlayer.position;
        document.getElementById('currentBidAmount').textContent = `₹${state.currentBid} Cr`;
        
        // Show franchise badge
        const franchiseBadge = document.getElementById('franchiseBadge');
        if (state.currentPlayer.franchiseId) {
            const franchiseTeam = allTeams.find(t => t.id === state.currentPlayer.franchiseId);
            franchiseBadge.textContent = franchiseTeam ? `${franchiseTeam.name} Player` : '';
            franchiseBadge.style.display = 'inline-block';
        } else {
            franchiseBadge.style.display = 'none';
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
        } else {
            adminControls.classList.add('hidden');
        }
        
        // Update teams status
        updateTeamsStatus(state);
    } else {
        noAuction.classList.remove('hidden');
        activeAuction.classList.add('hidden');
        document.getElementById('rtmPhase').classList.add('hidden');
    }
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
        div.innerHTML = `
            <h3>${player.name}</h3>
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

// Mark out
async function markOut() {
    try {
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

// Load teams budget
async function loadTeamsBudget() {
    try {
        const response = await fetch(`${API_BASE}/api/teams`);
        const teams = await response.json();
        updateTeamsBudget(teams);
    } catch (err) {
        console.error('Failed to load teams budget:', err);
    }
}

// Update teams budget display
function updateTeamsBudget(teams) {
    // Update local teams array with latest budget data
    teams.forEach(updatedTeam => {
        const team = allTeams.find(t => t.id === updatedTeam.id);
        if (team) {
            team.budget = updatedTeam.budget;
        }
    });
    
    teamsBudget.innerHTML = '';
    
    teams.forEach(team => {
        const div = document.createElement('div');
        div.className = 'budget-item';
        if (team.budget < 20) {
            div.classList.add('low-budget');
        }
        
        div.innerHTML = `
            <h3 style="color: ${team.color};">${team.name}</h3>
            <div class="budget-amount">₹${team.budget} Cr</div>
        `;
        
        teamsBudget.appendChild(div);
    });
    
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
        budgetInfo.innerHTML = `
            <h3>${teamInfo.name}</h3>
            <div class="budget">Budget: ₹${data.budget} Cr</div>
            <div style="margin-top: 10px; opacity: 0.9;">
                Players: ${data.players.length} | 
                Spent: ₹${(100 - data.budget).toFixed(1)} Cr
            </div>
        `;
        
        const playersDiv = document.getElementById('myTeamPlayers');
        
        if (data.players.length === 0) {
            console.log('⚠️ No players found');
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
    
    if (!teamId) {
        showToast('Please select a team', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/admin/complete-auction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Player marked as sold!', 'success');
            document.getElementById('adminTeamSelect').value = '';
        } else {
            showToast(data.error || 'Failed to complete auction', 'error');
        }
    } catch (err) {
        showToast('Failed to complete auction', 'error');
    }
}

document.getElementById('adminCompleteBtn').addEventListener('click', adminCompleteAuction);

// Admin team viewer
document.getElementById('adminTeamViewer').addEventListener('change', (e) => {
    const teamId = parseInt(e.target.value);
    if (teamId) {
        showMyTeam(teamId);
        e.target.value = ''; // Reset dropdown
    }
});

// Initialize app
init();

