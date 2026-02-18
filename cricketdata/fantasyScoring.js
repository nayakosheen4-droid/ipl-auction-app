/**
 * Fantasy point calculation (same rules as main build-fantasy-excel).
 * Exports processInnings, breakdowns, and buildRowsForMatch for use with Cricsheet-like or scorecard data.
 */

function getMatchDate(info) {
  const dates = info.dates;
  if (!dates || !dates.length) return null;
  return dates[0];
}

function getMatchName(info) {
  const teams = info.teams;
  if (!teams || teams.length < 2) return 'Unknown';
  return `${teams[0]} vs ${teams[1]}`;
}

function processInnings(innings) {
  const batting = {};
  const bowling = {};
  const fielding = {};

  for (const inn of innings) {
    for (const overData of inn.overs || []) {
      const deliveries = overData.deliveries || [];
      const runsThisOverByBowler = {};
      for (const del of deliveries) {
        const batter = del.batter;
        const bowler = del.bowler;
        const runs = del.runs || {};
        const batRuns = runs.batter != null ? runs.batter : 0;
        const totalRuns = runs.total != null ? runs.total : 0;
        const extras = del.extras || {};
        const isWideOrNoball = !!(extras.wides || extras.noballs);
        const countsAsBallFaced = !isWideOrNoball;
        if (batter) {
          if (!batting[batter]) batting[batter] = { runs: 0, fours: 0, sixes: 0, balls: 0, dismissed: false };
          batting[batter].runs += batRuns;
          if (batRuns === 4) batting[batter].fours += 1;
          if (batRuns === 6) batting[batter].sixes += 1;
          if (countsAsBallFaced) batting[batter].balls += 1;
        }
        if (bowler) {
          if (!bowling[bowler]) bowling[bowler] = { wickets: 0, lbwBowled: 0, runsConceded: 0, ballsBowled: 0, ballsBowledLegal: 0, dots: 0, overRuns: [] };
          bowling[bowler].runsConceded += totalRuns;
          bowling[bowler].ballsBowled += 1;
          if (!isWideOrNoball) bowling[bowler].ballsBowledLegal += 1;
          if (!isWideOrNoball && batRuns === 0) bowling[bowler].dots += 1;
          runsThisOverByBowler[bowler] = (runsThisOverByBowler[bowler] || 0) + totalRuns;
        }
        const wickets = del.wickets || [];
        for (const w of wickets) {
          const kind = (w.kind || '').toLowerCase();
          const isRunOut = kind === 'run out';
          const isLBWorBowled = kind === 'lbw' || kind === 'bowled';
          if (!isRunOut && bowler) { bowling[bowler].wickets += 1; if (isLBWorBowled) bowling[bowler].lbwBowled += 1; }
          const fielders = w.fielders || [];
          if (kind === 'caught') { for (const f of fielders) { const name = f.name; if (name) { if (!fielding[name]) fielding[name] = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0 }; fielding[name].catches += 1; } } }
          if (kind === 'caught and bowled' && bowler) { if (!fielding[bowler]) fielding[bowler] = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0 }; fielding[bowler].catches += 1; }
          if (kind === 'stumped') { for (const f of fielders) { const name = f.name; if (name) { if (!fielding[name]) fielding[name] = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0 }; fielding[name].stumpings += 1; } } }
          if (kind === 'run out') {
            if (fielders.length === 1) { const name = fielders[0].name; if (name) { if (!fielding[name]) fielding[name] = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0 }; fielding[name].directRunOut += 1; } }
            else if (fielders.length >= 2) { for (const f of fielders) { const name = f.name; if (name) { if (!fielding[name]) fielding[name] = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0 }; fielding[name].runOutAssist += 1; } } }
          }
        }
        if (wickets.length === 0 && del.review && del.review.type === 'wicket' && bowler) bowling[bowler].wickets += 1;
      }
      for (const [b, runsInOver] of Object.entries(runsThisOverByBowler)) { if (!bowling[b]) continue; bowling[b].overRuns.push(runsInOver); }
    }
    for (const overData of (inn.overs || [])) {
      for (const del of overData.deliveries || []) {
        for (const w of (del.wickets || [])) { const out = w.player_out; if (out && batting[out]) batting[out].dismissed = true; }
      }
    }
  }
  return { batting, bowling, fielding };
}

function battingBreakdown(batting, bowling, player) {
  const bat = batting[player];
  const empty = { runs: 0, fours: 0, sixes: 0, balls: 0, dismissed: 0, ptsRuns: 0, ptsFours: 0, ptsSixes: 0, ptsMilestone: 0, ptsDuck: 0, battingPts: 0 };
  if (!bat) return empty;
  const ptsRuns = bat.runs * 1;
  const ptsFours = bat.fours * 4;
  const ptsSixes = bat.sixes * 6;
  let ptsMilestone = 0;
  if (bat.runs >= 100) ptsMilestone = 16; else if (bat.runs >= 75) ptsMilestone = 12; else if (bat.runs >= 50) ptsMilestone = 8; else if (bat.runs >= 25) ptsMilestone = 4;
  let ptsDuck = 0;
  if (bat.runs === 0 && bat.dismissed && (!bowling[player] || bowling[player].ballsBowled === 0)) ptsDuck = -2;
  return { runs: bat.runs, fours: bat.fours, sixes: bat.sixes, balls: bat.balls, dismissed: bat.dismissed ? 1 : 0, ptsRuns, ptsFours, ptsSixes, ptsMilestone, ptsDuck, battingPts: ptsRuns + ptsFours + ptsSixes + ptsMilestone + ptsDuck };
}

function strikeRateBreakdown(batting, player) {
  const bat = batting[player];
  if (!bat || bat.balls < 10) return { strikeRate: null, ptsSR: 0 };
  const sr = bat.runs === 0 ? 0 : Math.round((bat.runs / bat.balls) * 10000) / 100;
  let pts = 0;
  if (sr > 170) pts = 6; else if (sr >= 150) pts = 4; else if (sr >= 130) pts = 2; else if (sr >= 60 && sr <= 70) pts = -2; else if (sr >= 50 && sr < 60) pts = -4; else if (sr < 50) pts = -6;
  return { strikeRate: sr, ptsSR: pts };
}

function bowlingBreakdown(bowling, player) {
  const bowl = bowling[player];
  const empty = { wickets: 0, lbwBowled: 0, dots: 0, maidens: 0, runsConceded: 0, ballsBowled: 0, ptsWickets: 0, ptsLBWBowled: 0, ptsDots: 0, ptsMaidens: 0, ptsWktBonus: 0, bowlingPts: 0 };
  if (!bowl) return empty;
  const maidens = (bowl.overRuns || []).filter((r) => r === 0).length;
  const ptsWickets = bowl.wickets * 30;
  const ptsLBWBowled = bowl.lbwBowled * 8;
  const ptsDots = bowl.dots * 1;
  const ptsMaidens = maidens * 12;
  let ptsWktBonus = 0;
  if (bowl.wickets >= 5) ptsWktBonus = 16; else if (bowl.wickets >= 4) ptsWktBonus = 8; else if (bowl.wickets >= 3) ptsWktBonus = 4;
  return { wickets: bowl.wickets, lbwBowled: bowl.lbwBowled, dots: bowl.dots, maidens, runsConceded: bowl.runsConceded, ballsBowled: bowl.ballsBowled, ptsWickets, ptsLBWBowled, ptsDots, ptsMaidens, ptsWktBonus, bowlingPts: ptsWickets + ptsLBWBowled + ptsDots + ptsMaidens + ptsWktBonus };
}

function economyBreakdown(bowling, player) {
  const bowl = bowling[player];
  const legal = bowl && bowl.ballsBowledLegal != null ? bowl.ballsBowledLegal : (bowl && bowl.ballsBowled) || 0;
  if (!bowl || legal < 12) return { overs: null, economy: null, ptsEconomy: 0 };
  const overs = Math.round((legal / 6) * 100) / 100;
  const economy = Math.round((bowl.runsConceded / (legal / 6)) * 100) / 100;
  let pts = 0;
  if (economy < 5) pts = 6; else if (economy <= 5.99) pts = 4; else if (economy <= 7) pts = 2; else if (economy >= 10 && economy <= 11) pts = -2; else if (economy > 11 && economy <= 12) pts = -4; else if (economy > 12) pts = -6;
  return { overs, economy, ptsEconomy: pts };
}

function fieldingBreakdown(fielding, player) {
  const f = fielding[player];
  const empty = { catches: 0, stumpings: 0, directRunOut: 0, runOutAssist: 0, ptsCatches: 0, pts3Catch: 0, ptsStumpings: 0, ptsDirectRO: 0, ptsAssistRO: 0, fieldingPts: 0 };
  if (!f) return empty;
  const ptsCatches = f.catches * 8;
  const pts3Catch = f.catches >= 3 ? 4 : 0;
  return { catches: f.catches, stumpings: f.stumpings, directRunOut: f.directRunOut, runOutAssist: f.runOutAssist, ptsCatches, pts3Catch, ptsStumpings: f.stumpings * 12, ptsDirectRO: f.directRunOut * 12, ptsAssistRO: f.runOutAssist * 6, fieldingPts: ptsCatches + pts3Catch + f.stumpings * 12 + f.directRunOut * 12 + f.runOutAssist * 6 };
}

function allPlayersInMatch(info) {
  const players = info.players || {};
  const set = new Set();
  for (const team of Object.values(players)) for (const p of team) set.add(p);
  return Array.from(set);
}

/** Build fantasy rows for one match. match = { info, innings } or { info, stats }. */
function buildRowsForMatch(match, matchIndex, matchTeamRound, allowedCountries) {
  const info = match.info;
  const stats = match.stats || processInnings(match.innings || []);
  const date = getMatchDate(info);
  const matchName = getMatchName(info);
  const players = allPlayersInMatch(info);
  const teams = info.teams || [];
  const playerOfMatch = (info.player_of_match || []).map((p) => (p || '').trim());
  const rows = [];
  for (const player of players) {
    let team = teams.find((t) => (info.players[t] || []).includes(player));
    if (!team && teams.length) team = teams[0];
    if (team && allowedCountries.length && !allowedCountries.includes(team)) continue;
    const bat = battingBreakdown(stats.batting, stats.bowling, player);
    const sr = strikeRateBreakdown(stats.batting, player);
    const bowl = bowlingBreakdown(stats.bowling, player);
    const ec = economyBreakdown(stats.bowling, player);
    const fl = fieldingBreakdown(stats.fielding, player);
    const ptsPlaying = 4;
    const ptsPOTM = playerOfMatch.includes(player) ? 50 : 0;
    const totalPts = bat.battingPts + sr.ptsSR + bowl.bowlingPts + ec.ptsEconomy + fl.fieldingPts + ptsPlaying + ptsPOTM;
    const roundKey = team ? `${matchIndex}_${team}` : null;
    const round = roundKey ? matchTeamRound[roundKey] || null : null;
    rows.push({
      playerName: player,
      country: team || '',
      matchName,
      matchDate: date,
      roundNumber: round,
      fantasyPoints: totalPts,
      ptsPlaying,
      ptsPOTM,
      runs: bat.runs,
      fours: bat.fours,
      sixes: bat.sixes,
      ballsFaced: bat.balls,
      dismissed: bat.dismissed,
      ptsRuns: bat.ptsRuns,
      ptsFours: bat.ptsFours,
      ptsSixes: bat.ptsSixes,
      ptsMilestone: bat.ptsMilestone,
      ptsDuck: bat.ptsDuck,
      battingPts: bat.battingPts,
      strikeRate: sr.strikeRate != null ? sr.strikeRate : '',
      ptsSR: sr.ptsSR,
      wickets: bowl.wickets,
      lbwBowled: bowl.lbwBowled,
      dots: bowl.dots,
      maidens: bowl.maidens,
      runsConceded: bowl.runsConceded,
      ballsBowled: bowl.ballsBowled,
      ptsWickets: bowl.ptsWickets,
      ptsLBWBowled: bowl.ptsLBWBowled,
      ptsDots: bowl.ptsDots,
      ptsMaidens: bowl.ptsMaidens,
      ptsWktBonus: bowl.ptsWktBonus,
      bowlingPts: bowl.bowlingPts,
      overs: ec.overs != null ? ec.overs : '',
      economy: ec.economy != null ? ec.economy : '',
      ptsEconomy: ec.ptsEconomy,
      catches: fl.catches,
      stumpings: fl.stumpings,
      directRunOut: fl.directRunOut,
      runOutAssist: fl.runOutAssist,
      ptsCatches: fl.ptsCatches,
      pts3Catch: fl.pts3Catch,
      ptsStumpings: fl.ptsStumpings,
      ptsDirectRO: fl.ptsDirectRO,
      ptsAssistRO: fl.ptsAssistRO,
      fieldingPts: fl.fieldingPts,
    });
  }
  return rows;
}

module.exports = {
  getMatchDate,
  getMatchName,
  processInnings,
  battingBreakdown,
  strikeRateBreakdown,
  bowlingBreakdown,
  economyBreakdown,
  fieldingBreakdown,
  allPlayersInMatch,
  buildRowsForMatch,
};
