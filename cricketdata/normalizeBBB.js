/**
 * Normalize CricAPI match_bbb response to Cricsheet-like innings (overs with deliveries)
 * for processInnings() so we get dots and full bowling stats.
 *
 * CricAPI match_bbb response shape (v1 free tier):
 *   data.bbb = [ { n, inning (0-based), over, ball, batsman: { id, name }, bowler: { id, name },
 *                   runs, penalty, extras }, ... ]
 *   NOTE: free tier only returns extras/penalty balls, not every delivery.
 *   If the BBB array is sparse (< 60% of expected balls), the caller should skip BBB
 *   and fall back to scorecard stats.
 *
 * Also handles:
 * - data.balls / data.ball (flat list)
 * - data.innings[].overs[].deliveries (already nested, e.g. from Cricsheet)
 */

function getName(obj) {
  if (obj == null) return null;
  if (typeof obj === 'string') return obj.trim() || null;
  return (obj.name || obj.full_name || obj.player_name || '').trim() || null;
}

/**
 * Convert a CricAPI BBB ball to a Cricsheet-style delivery.
 * processInnings expects: { batter, bowler, runs: { batter, total }, extras: {}, wickets: [] }
 */
function ballToDelivery(ball) {
  const batter = getName(ball.batsman || ball.striker);
  const bowler = getName(ball.bowler);

  const batRuns = parseInt(ball.runs, 10) || 0;
  const extraRuns = parseInt(ball.extras, 10) || 0;
  const totalRuns = batRuns + extraRuns;

  const extras = {};
  const penalty = (ball.penalty || '').toLowerCase();
  if (penalty === 'wide' || penalty === 'wides') extras.wides = extraRuns || 1;
  else if (penalty === 'noball' || penalty === 'no ball' || penalty === 'no_ball') extras.noballs = extraRuns || 1;
  else if (penalty === 'byes') extras.byes = extraRuns || 1;
  else if (penalty === 'legbyes' || penalty === 'leg byes') extras.legbyes = extraRuns || 1;

  const wickets = [];
  const wicketType = (ball.wicket_type || ball.dismissal_type || '').toLowerCase();
  if (wicketType) {
    const playerOut = ball.player_out || ball.out_batsman;
    const outName = getName(typeof playerOut === 'object' ? playerOut : { name: playerOut }) || batter;
    const fielders = [];
    if (ball.fielder) {
      const fn = getName(ball.fielder);
      if (fn) fielders.push({ name: fn });
    }
    wickets.push({ kind: wicketType, player_out: outName, fielders });
  }

  return {
    batter: batter || undefined,
    bowler: bowler || undefined,
    runs: { batter: batRuns, total: totalRuns },
    extras: Object.keys(extras).length ? extras : undefined,
    wickets: wickets.length ? wickets : undefined,
  };
}

/**
 * Normalize BBB response to innings[] with overs[].deliveries[].
 * Returns { innings, totalBalls } so the caller can check if BBB is complete enough.
 */
function normalizeBBBToInnings(bbbResponse) {
  const data = bbbResponse && (bbbResponse.data || bbbResponse);
  if (!data) return null;

  // CricAPI v1 format: data.bbb array
  let balls = data.bbb;

  // Fallback: data.balls or data.ball
  if (!balls) balls = data.balls || data.ball;

  // Already nested format (data.innings[].overs[].deliveries)
  if (!balls && data.innings && Array.isArray(data.innings)) {
    const out = [];
    let totalBalls = 0;
    for (const inn of data.innings) {
      const overs = inn.overs || [];
      const outOvers = [];
      for (const o of overs) {
        const deliveries = (o.deliveries || o.balls || []).map((d) => {
          if (d.batter !== undefined && d.runs !== undefined) return d;
          return ballToDelivery(d);
        });
        totalBalls += deliveries.length;
        outOvers.push({ over: o.over ?? outOvers.length, deliveries });
      }
      out.push({ overs: outOvers });
    }
    return out.length > 0 ? { innings: out, totalBalls } : null;
  }

  // Convert object map to array
  if (!Array.isArray(balls)) {
    if (balls && typeof balls === 'object') {
      balls = Object.values(balls);
    } else {
      return null;
    }
  }

  if (balls.length === 0) return null;

  // Group by innings (inning is 0-based in CricAPI) then by over
  const byInnings = {};
  for (const b of balls) {
    const innNum = b.inning != null ? String(b.inning) : (b.innings != null ? String(b.innings) : '0');
    if (!byInnings[innNum]) byInnings[innNum] = {};
    const overNum = parseInt(b.over, 10) || 0;
    if (!byInnings[innNum][overNum]) byInnings[innNum][overNum] = [];
    byInnings[innNum][overNum].push(ballToDelivery(b));
  }

  const inningsOrder = Object.keys(byInnings).sort((a, b) => parseInt(a) - parseInt(b));
  const result = [];
  for (const innKey of inningsOrder) {
    const overNums = Object.keys(byInnings[innKey]).map(Number).sort((a, b) => a - b);
    result.push({
      overs: overNums.map((on) => ({
        over: on,
        deliveries: byInnings[innKey][on],
      })),
    });
  }
  return result.length ? { innings: result, totalBalls: balls.length } : null;
}

module.exports = { normalizeBBBToInnings };
