# 🚧 Implementation Plan for Remaining Features

## Feature 3: Team Toggle Panel (Left Panel)
- Add toggle button to switch between "Available Players" and "All Teams"
- When viewing "All Teams", show each team with:
  - Team name and color
  - Current budget
  - Player count
  - Click to expand and see full squad

## Feature 4: Enhanced Team View
Add to "My Team" modal:
- **Position Breakdown:**
  - Batsmen: X/∞
  - Bowlers: X/∞
  - All-rounders: X/∞
  - Wicket-keepers: X/∞
- **Total Players:** X/18
- **Budget Remaining:** ₹X Cr
- **Max Bid Allowed:** ₹X Cr (calculated based on 16 player minimum)

**Max Bid Calculation Logic:**
```
playersNeeded = 16 - currentPlayerCount
if (playersNeeded > 0) {
    maxBid = budget - (playersNeeded * 0.5)
} else {
    maxBid = budget  // Can spend all if minimum met
}
```

## Feature 5: Squad Composition Rules

### Minimum Requirements:
- 1 Wicket-keeper
- 3 Bowlers  
- 3 Batsmen
- 2 All-rounders
- Total: 16 players minimum, 18 maximum

### Validation Points:
1. **Before Bidding:** Check if bid would violate rules
2. **Before "Mark Out":** Check if remaining budget can complete minimum squad
3. **Squad Full (18 players):** Block all bidding

### Implementation:
- Add validation function to check squad composition
- Show warning if approaching max players without meeting minimums
- Block bids that would make it impossible to meet requirements
- Add visual indicators (red/yellow/green) for each position requirement

### Error Messages:
- "Cannot buy more players (max 18 reached)"
- "You need at least X more [position] to meet minimum requirements"
- "Insufficient budget to complete minimum squad if you pass on this player"

