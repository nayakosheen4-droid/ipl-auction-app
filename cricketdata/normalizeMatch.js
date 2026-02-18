/**
 * Normalize API match response to Cricsheet-like shape { info, innings }
 * or to stats shape { batting, bowling, fielding } for fantasy scoring.
 * Handles: 1) Already Cricsheet-like (info + innings with overs/deliveries), 2) Scorecard-style (batting/bowling arrays).
 */

function normalizeMatch(raw) {
  const data = raw.data || raw.match || raw;
  if (!data) return null;

  const info = data.info || data.matchInfo || data;
  const teams = info.teams || data.teams || [info.team1, info.team2].filter(Boolean) || [];
  const players = info.players || {};
  const playerOfMatch =
    info.player_of_match ||
    info.playerOfMatch ||
    info.playerOfTheMatch ||
    data.player_of_match ||
    data.playerOfMatch ||
    data.playerOfTheMatch;
  const dates = info.dates || (info.date || data.date ? [info.date || data.date] : []);

  // CricAPI match_scorecard: data.scorecard = [ { batting, bowling, catching, inning }, ... ]
  const scorecardArray = data.scorecard;
  if (scorecardArray && Array.isArray(scorecardArray) && scorecardArray.length > 0) {
    const batting = {};
    const bowling = {};
    const fielding = {};
    const allNames = new Set();
    const teamToPlayers = {};

    const tossWinner = (data.tossWinner || info.tossWinner || '').toString().trim();
    const tossChoice = (data.tossChoice || info.tossChoice || '').toString().trim().toLowerCase();
    let firstBattingTeam = null;
    if (tossWinner && tossChoice && teams.length === 2) {
      const tw = teams.find(t => t.toLowerCase() === tossWinner.toLowerCase());
      if (tw) {
        firstBattingTeam = tossChoice === 'bat' ? tw : teams.find(t => t !== tw);
      }
    }

    for (let innIdx = 0; innIdx < scorecardArray.length; innIdx++) {
      const inn = scorecardArray[innIdx];
      const inningLabel = (inn.inning || '').toString();
      let battingTeamRaw = inningLabel.replace(/\s+Inning\s+\d+$/i, '').trim();

      let battingTeam = battingTeamRaw;
      if (battingTeamRaw.includes(',')) {
        const parts = battingTeamRaw.split(',').map(s => s.trim());
        const alreadyBatting = Object.keys(teamToPlayers);
        const notYetBatting = parts.find(p =>
          !alreadyBatting.some(t => t.toLowerCase() === p.toLowerCase())
        );
        battingTeam = notYetBatting || parts[0];
      }
      if (teams.length > 0) {
        const matched = teams.find(t => t.toLowerCase() === battingTeam.toLowerCase());
        if (matched) battingTeam = matched;
      }

      if (firstBattingTeam && teams.length === 2) {
        if (innIdx === 0) battingTeam = firstBattingTeam;
        else battingTeam = teams.find(t => t !== firstBattingTeam) || battingTeam;
      }

      if (battingTeam && !teamToPlayers[battingTeam]) teamToPlayers[battingTeam] = new Set();

      for (const b of inn.batting || []) {
        const name = (b.batsman && b.batsman.name) || b.name;
        if (!name) continue;
        allNames.add(name);
        if (battingTeam) teamToPlayers[battingTeam].add(name);
        const runs = parseInt(b.r, 10) || 0;
        const balls = parseInt(b.b, 10) || 0;
        const fours = parseInt(b['4s'], 10) || 0;
        const sixes = parseInt(b['6s'], 10) || 0;
        const dismissed = b.dismissal && (b['dismissal-text'] || '').toLowerCase() !== 'not out';
        if (!batting[name]) batting[name] = { runs: 0, fours: 0, sixes: 0, balls: 0, dismissed: false };
        batting[name].runs += runs;
        batting[name].fours += fours;
        batting[name].sixes += sixes;
        batting[name].balls += balls;
        if (dismissed) batting[name].dismissed = true;

        const dismissalType = (b.dismissal || '').toLowerCase();
        if ((dismissalType === 'lbw' || dismissalType === 'bowled') && b.bowler) {
          const bowlerName = (b.bowler && typeof b.bowler === 'object') ? b.bowler.name : b.bowler;
          if (bowlerName) {
            if (!bowling[bowlerName])
              bowling[bowlerName] = { wickets: 0, lbwBowled: 0, runsConceded: 0, ballsBowled: 0, ballsBowledLegal: 0, dots: 0, overRuns: [] };
            bowling[bowlerName].lbwBowled += 1;
          }
        }
      }
      for (const b of inn.bowling || []) {
        const name = (b.bowler && b.bowler.name) || b.name;
        if (!name) continue;
        allNames.add(name);
        const opp = teams.length === 2 ? teams.find((t) => t && t !== battingTeam) : null;
        if (opp) { if (!teamToPlayers[opp]) teamToPlayers[opp] = new Set(); teamToPlayers[opp].add(name); }
        const wickets = parseInt(b.w, 10) || 0;
        const runsConceded = parseInt(b.r, 10) || 0;
        const overs = parseFloat(b.o, 10) || 0;
        const maidens = parseInt(b.m, 10) || 0;
        const ballsBowled = Math.round(overs * 6);
        const nonMaidenOvers = Math.max(0, Math.floor(overs) - maidens);
        const overRuns = Array(maidens).fill(0);
        if (nonMaidenOvers > 0) {
          const perOver = Math.floor(runsConceded / nonMaidenOvers);
          for (let i = 0; i < nonMaidenOvers - 1; i++) overRuns.push(perOver);
          overRuns.push(runsConceded - perOver * (nonMaidenOvers - 1));
        }
        if (!bowling[name])
          bowling[name] = { wickets: 0, lbwBowled: 0, runsConceded: 0, ballsBowled: 0, ballsBowledLegal: 0, dots: 0, overRuns: [] };
        /* API scorecard does not provide dot-ball count per bowler; dots stay 0, so fantasy pts from dots are missing vs Cricsheet */
        bowling[name].wickets += wickets;
        bowling[name].runsConceded += runsConceded;
        bowling[name].ballsBowled += ballsBowled;
        bowling[name].ballsBowledLegal = ballsBowled;
        bowling[name].overRuns = (bowling[name].overRuns || []).concat(overRuns);
      }
      for (const c of inn.catching || []) {
        const name = (c.catcher && c.catcher.name) || c.name;
        if (!name) continue;
        allNames.add(name);
        const fieldingTeam = teams.length === 2 ? teams.find((t) => t && t !== battingTeam) : null;
        if (fieldingTeam) { if (!teamToPlayers[fieldingTeam]) teamToPlayers[fieldingTeam] = new Set(); teamToPlayers[fieldingTeam].add(name); }
        const catches = parseInt(c.catch, 10) || 0;
        const stumpings = parseInt(c.stumped, 10) || 0;
        const runouts = parseInt(c.runout, 10) || 0;
        if (!fielding[name]) fielding[name] = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0 };
        fielding[name].catches += catches;
        fielding[name].stumpings += stumpings;
        fielding[name].directRunOut += runouts;
      }
    }

    const teamsList = teams.length ? teams : Array.from(Object.keys(teamToPlayers));
    const firstTeam = teamsList[0] || (Object.keys(teamToPlayers)[0]);
    for (const name of allNames) {
      let inAny = false;
      for (const t of Object.keys(teamToPlayers)) {
        if (teamToPlayers[t].has(name)) { inAny = true; break; }
      }
      if (!inAny && firstTeam) {
        if (!teamToPlayers[firstTeam]) teamToPlayers[firstTeam] = new Set();
        teamToPlayers[firstTeam].add(name);
      }
    }
    const playersMap = players && Object.keys(players).length ? players : Object.fromEntries([...Object.entries(teamToPlayers)].map(([t, set]) => [t, Array.from(set)]));
    if (Object.keys(playersMap).length === 0) playersMap[''] = Array.from(allNames);
    return {
      info: {
        teams: teamsList.length ? teamsList : ['', ''],
        players: playersMap,
        player_of_match: Array.isArray(playerOfMatch) ? playerOfMatch : playerOfMatch ? [playerOfMatch] : [],
        dates: dates.length ? dates : (data.date ? [data.date] : []),
      },
      stats: { batting, bowling, fielding },
    };
  }

  const innings = data.innings || info.innings;
  if (innings && Array.isArray(innings) && innings.length > 0) {
    const firstInn = innings[0];
    const hasDeliveries =
      firstInn.overs &&
      Array.isArray(firstInn.overs) &&
      firstInn.overs.some((o) => o.deliveries && Array.isArray(o.deliveries));
    if (hasDeliveries) {
      return {
        info: {
          teams,
          players,
          player_of_match: Array.isArray(playerOfMatch) ? playerOfMatch : playerOfMatch ? [playerOfMatch] : [],
          dates,
        },
        innings,
      };
    }
  }

  const scorecard = data.scorecard || data.scoreCard || data;
  const battingInns = scorecard.batting || scorecard.batting_innings || [];
  const bowlingInns = scorecard.bowling || scorecard.bowling_innings || [];
  const batting = {};
  const bowling = {};
  const fielding = {};

  for (const inn of battingInns) {
    const team = inn.team || inn.batting_team;
    const list = inn.batsmen || inn.batting || inn;
    const arr = Array.isArray(list) ? list : list ? [list] : [];
    for (const b of arr) {
      const name = b.name || b.batsman || b.player;
      if (!name) continue;
      const runs = parseInt(b.runs, 10) || 0;
      const balls = parseInt(b.balls, 10) || parseInt(b.balls_faced, 10) || 0;
      const fours = parseInt(b.fours, 10) || 0;
      const sixes = parseInt(b.sixes, 10) || 0;
      const dismissed = b.dismissed !== undefined ? b.dismissed : (b.how_out && b.how_out !== 'not out');
      if (!batting[name]) batting[name] = { runs: 0, fours: 0, sixes: 0, balls: 0, dismissed: false };
      batting[name].runs += runs;
      batting[name].fours += fours;
      batting[name].sixes += sixes;
      batting[name].balls += balls;
      if (dismissed) batting[name].dismissed = true;
    }
  }

  for (const inn of bowlingInns) {
    const list = inn.bowlers || inn.bowling || inn;
    const arr = Array.isArray(list) ? list : list ? [list] : [];
    for (const b of arr) {
      const name = b.name || b.bowler || b.player;
      if (!name) continue;
      const wickets = parseInt(b.wickets, 10) || 0;
      const runsConceded = parseInt(b.runs, 10) || parseInt(b.runs_conceded, 10) || 0;
      const overs = parseFloat(b.overs, 10) || parseFloat(b.overs_bowled, 10) || 0;
      const ballsBowled = Math.round(overs * 6) || parseInt(b.balls, 10) || 0;
      const dots = parseInt(b.dot_balls, 10) || parseInt(b.dots, 10) || 0;
      const maidens = parseInt(b.maidens, 10) || 0;
      const lbwBowled = parseInt(b.lbw_bowled, 10) || 0;
      if (!bowling[name])
        bowling[name] = {
          wickets: 0,
          lbwBowled: 0,
          runsConceded: 0,
          ballsBowled: 0,
          ballsBowledLegal: 0,
          dots: 0,
          overRuns: [],
        };
      bowling[name].wickets += wickets;
      bowling[name].lbwBowled += lbwBowled;
      bowling[name].runsConceded += runsConceded;
      bowling[name].ballsBowled += ballsBowled;
      bowling[name].ballsBowledLegal = ballsBowled;
      bowling[name].dots += dots;
      for (let m = 0; m < maidens; m++) bowling[name].overRuns.push(0);
      const nonMaidenOvers = Math.max(0, (ballsBowled / 6) - maidens);
      for (let i = 0; i < Math.floor(nonMaidenOvers); i++) bowling[name].overRuns.push(6);
    }
  }

  const fieldingList = scorecard.fielding || scorecard.fielding_innings || [];
  for (const f of fieldingList) {
    const arr = Array.isArray(f) ? f : f.catches ? [f] : [];
    for (const x of arr) {
      const name = x.name || x.fielder || x.player;
      if (!name) continue;
      if (!fielding[name]) fielding[name] = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0 };
      fielding[name].catches += parseInt(x.catches, 10) || 0;
      fielding[name].stumpings += parseInt(x.stumpings, 10) || 0;
      fielding[name].directRunOut += parseInt(x.run_outs, 10) || parseInt(x.direct_run_out, 10) || 0;
      fielding[name].runOutAssist += parseInt(x.run_out_assists, 10) || 0;
    }
  }

  const allNames = new Set([...Object.keys(batting), ...Object.keys(bowling), ...Object.keys(fielding)]);
  const playersMap = players && Object.keys(players).length ? players : { '': Array.from(allNames) };
  const teamsList = teams.length ? teams : (info.team1 && info.team2 ? [info.team1, info.team2] : ['', '']);

  return {
    info: {
      teams: teamsList,
      players: playersMap,
      player_of_match: Array.isArray(playerOfMatch) ? playerOfMatch : playerOfMatch ? [playerOfMatch] : [],
      dates,
    },
    stats: { batting, bowling, fielding },
  };
}

module.exports = { normalizeMatch };
