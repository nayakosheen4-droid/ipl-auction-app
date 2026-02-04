# RTM Testing Instructions

## Deploy Status
✅ All fixes pushed - Railway deploying now (~2 minutes)

## Critical Fixes Applied

### 1. completeAuction Crash Fixed
- Was accessing `currentPlayer.name` after setting to null
- Now saves player name BEFORE reset
- No more null reference errors

### 2. Bidirectional Nomination Order
- **Pattern**: Forward → Reverse → Forward (ping-pong)
- **Example**: MI → CSK → GT → RR → LSG → RCB → RCB ← LSG ← RR ← GT ← CSK ← MI → ...
- **State Preserved**: nominationOrder, direction, index all maintained

### 3. nominationDirection Field Added
- Added to all auctionState initializations
- Preserves direction through auctions
- Logs show → (forward) or ← (reverse)

## Test RTM (Your Exact Scenario)

1. **Login as Admin**
2. **Initialize Auction Order** (only once!)
3. **Nominate Sunil Narine** (KKR player, franchiseId: 4)
4. **Mark teams Out:**
   - Mark: MI, CSK, RCB, KKR, DC, PBKS, RR, SRH, GT as "Out"
   - Leave: LSG active
5. **Wait 30 seconds** for auto-sell timer

### What SHOULD Happen:

✅ **Railway Logs Show:**
```
🔍 RTM Check for Kolkata Knight Riders:
  - Has franchise: true
  - RTM not used: true
  - Not winning bidder: true (LSG is winner, not KKR)
  - Has budget: true (₹100 >= ₹0.5)
  - Winner is: Lucknow Super Giants
🎯 RTM opportunity available for Kolkata Knight Riders
⏱️  Starting 30-second RTM countdown timer
```

✅ **Frontend Shows (for KKR team):**
- RTM modal appears
- Message: "Kolkata Knight Riders has the Right to Match for Sunil Narine..."
- "Current bid: ₹0.5 Cr by Lucknow Super Giants"
- Two buttons: [Use RTM Card] [Decline RTM]

✅ **After RTM Decision:**
- Player sold to KKR (if RTM used) or LSG (if declined)
- Auction continues to NEXT team in order
- NO "Initialize Auction Order" button appears

## Test Bidirectional Order

1. **Note the initial order** (shown after Initialize)
   - Example: MI → CSK → GT → RR → LSG → RCB
2. **Complete 6 auctions** (one per team forward)
3. **Check 7th auction**: Should be RCB again (reverse starts)
4. **Check 8th auction**: Should be LSG (going backward)
5. **Continue**: GT ← RR ← CSK ← MI
6. **Check 13th auction**: Should be MI again (forward resumes)

### Railway Logs Show:
```
✅ Turn advanced to: Mumbai Indians → (Index: 0)
✅ Turn advanced to: Chennai Super Kings → (Index: 1)
...
✅ Turn advanced to: Royal Challengers Bangalore → (Index: 5)
🔄 Reached end of order - reversing direction
✅ Turn advanced to: Royal Challengers Bangalore ← (Index: 5)
✅ Turn advanced to: Lucknow Super Giants ← (Index: 4)
...
🔄 Reached start of order - reversing direction
✅ Turn advanced to: Mumbai Indians → (Index: 0)
```

## If RTM Still Doesn't Show

### Check Railway Logs:
1. Go to Railway dashboard → Deployments
2. Click "View Logs"
3. Look for "🔍 RTM Check for..." after timer expires
4. Check which condition failed:
   - `Has franchise: false` → Player's franchiseId doesn't match any team
   - `RTM not used: false` → Team already used their RTM card
   - `Not winning bidder: false` → Same team won the bid (no RTM for self)
   - `Has budget: false` → Team can't afford the bid

### Common Issues:
- **No RTM log at all**: Timer didn't expire or backend crashed
- **franchiseId mismatch**: Check Sunil Narine has franchiseId: 4
- **Wrong team logged in**: Login as KKR to see RTM buttons

### Debug WebSocket:
1. Open browser console (F12)
2. Go to Network tab
3. Filter by "WS" (WebSocket)
4. After timer expires, check for message: `{type: 'rtm_opportunity'}`
5. If missing, backend didn't send it

## Expected Results

✅ RTM works even when teams marked "Out"  
✅ Auction state preserved after every sale  
✅ Initialize button NEVER appears after initialization  
✅ Turn order: Forward → Reverse → Forward (continuous)  
✅ Direction arrows in logs (→ ←)  
✅ All 10 teams work correctly  

---

**Test in ~2 minutes when deployment completes!**

If still broken, provide:
1. Railway logs (last 50 lines after timer expires)
2. Browser console errors (F12 → Console)
3. Which team you're logged in as
