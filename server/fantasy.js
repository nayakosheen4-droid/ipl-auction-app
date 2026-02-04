// Fantasy League Scoring System

// Dream11-style scoring formula
const SCORING_RULES = {
  // Batting Points
  runs: 1,                    // 1 point per run
  fours: 1,                   // 1 point per boundary
  sixes: 2,                   // 2 points per six
  thirty_run_bonus: 4,        // 4 points for 30+ runs
  fifty_run_bonus: 8,         // 8 points for 50+ runs
  century_bonus: 16,          // 16 points for 100+ runs
  duck: -2,                   // -2 points for duck (batsman/wicket-keeper)
  
  // Bowling Points
  wicket: 25,                 // 25 points per wicket
  lbw_bowled_bonus: 8,        // 8 bonus points for LBW/Bowled
  three_wicket_bonus: 4,      // 4 points for 3 wickets
  four_wicket_bonus: 8,       // 8 points for 4 wickets
  five_wicket_bonus: 16,      // 16 points for 5 wickets
  maiden_over: 12,            // 12 points per maiden over
  
  // Fielding Points
  catch: 8,                   // 8 points per catch
  stumping: 12,               // 12 points per stumping (wicket-keeper only)
  run_out_direct: 12,         // 12 points for direct run out
  run_out_indirect: 6,        // 6 points for indirect run out
  
  // Economy/Strike Rate (Bonus)
  economy_rate_below_5: 6,    // Below 5 (min 2 overs)
  economy_rate_5_to_6: 4,     // Between 5-6 (min 2 overs)
  economy_rate_9_to_10: -2,   // Between 9-10 (min 2 overs)
  economy_rate_above_11: -4,  // Above 11 (min 2 overs)
  
  strike_rate_above_170: 6,   // Above 170 (min 10 balls)
  strike_rate_150_to_170: 4,  // 150-170 (min 10 balls)
  strike_rate_below_70: -2,   // Below 70 (min 10 balls)
  strike_rate_below_50: -4    // Below 50 (min 10 balls)
};

// Calculate fantasy points for a player
function calculateFantasyPoints(stats, position) {
  let points = 0;
  
  // Batting points
  points += (stats.runs || 0) * SCORING_RULES.runs;
  points += (stats.fours || 0) * SCORING_RULES.fours;
  points += (stats.sixes || 0) * SCORING_RULES.sixes;
  
  const runs = stats.runs || 0;
  if (runs >= 100) points += SCORING_RULES.century_bonus;
  else if (runs >= 50) points += SCORING_RULES.fifty_run_bonus;
  else if (runs >= 30) points += SCORING_RULES.thirty_run_bonus;
  
  // Duck penalty (only for batsman and wicket-keeper)
  if ((position === 'Batsman' || position === 'Wicket-keeper') && runs === 0 && (stats.ballsFaced || 0) > 0) {
    points += SCORING_RULES.duck;
  }
  
  // Bowling points
  const wickets = stats.wickets || 0;
  points += wickets * SCORING_RULES.wicket;
  points += (stats.lbw_bowled || 0) * SCORING_RULES.lbw_bowled_bonus;
  points += (stats.maidens || 0) * SCORING_RULES.maiden_over;
  
  if (wickets >= 5) points += SCORING_RULES.five_wicket_bonus;
  else if (wickets >= 4) points += SCORING_RULES.four_wicket_bonus;
  else if (wickets >= 3) points += SCORING_RULES.three_wicket_bonus;
  
  // Fielding points
  points += (stats.catches || 0) * SCORING_RULES.catch;
  points += (stats.stumpings || 0) * SCORING_RULES.stumping;
  points += (stats.runOutDirect || 0) * SCORING_RULES.run_out_direct;
  points += (stats.runOutIndirect || 0) * SCORING_RULES.run_out_indirect;
  
  // Economy rate bonus (for bowlers who bowled at least 2 overs)
  const oversBowled = stats.oversBowled || 0;
  const economyRate = stats.economyRate || 0;
  
  if (oversBowled >= 2 && economyRate > 0) {
    if (economyRate < 5) points += SCORING_RULES.economy_rate_below_5;
    else if (economyRate <= 6) points += SCORING_RULES.economy_rate_5_to_6;
    else if (economyRate >= 9 && economyRate <= 10) points += SCORING_RULES.economy_rate_9_to_10;
    else if (economyRate > 11) points += SCORING_RULES.economy_rate_above_11;
  }
  
  // Strike rate bonus (for batsmen who faced at least 10 balls)
  const ballsFaced = stats.ballsFaced || 0;
  const strikeRate = stats.strikeRate || 0;
  
  if (ballsFaced >= 10 && strikeRate > 0) {
    if (strikeRate > 170) points += SCORING_RULES.strike_rate_above_170;
    else if (strikeRate >= 150) points += SCORING_RULES.strike_rate_150_to_170;
    else if (strikeRate < 50) points += SCORING_RULES.strike_rate_below_50;
    else if (strikeRate < 70) points += SCORING_RULES.strike_rate_below_70;
  }
  
  return Math.round(points * 10) / 10; // Round to 1 decimal
}

module.exports = {
  SCORING_RULES,
  calculateFantasyPoints
};
