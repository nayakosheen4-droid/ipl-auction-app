# Testing Guide

## Issue Fixed
The Excel file was missing the "RTM Used" column which was causing silent failures when saving sold players. The file has been regenerated with the correct schema.

## How to Test

### Test 1: Sell a Player (Normal Auction)
1. **Open Browser 1** - Login as Mumbai Indians (`mi2024`)
2. **Open Browser 2** - Login as RCB (`rcb2024`)
3. From MI: Click on "Virat Kohli" to nominate
4. From RCB: Click "+2 Cr" to bid (now at ₹2.5 Cr)
5. From MI: Click "Mark Out"
6. **Expected**: RCB should see RTM opportunity (Virat is RCB player)
7. From RCB: Click "Use RTM Card"
8. **Verify**:
   - ✅ Toast shows "Virat Kohli sold to Royal Challengers Bangalore for ₹2.5 Cr (RTM Used)!"
   - ✅ RCB budget changes from ₹100 Cr to ₹97.5 Cr
   - ✅ Virat Kohli **disappears** from available players list
   - ✅ Click "View My Team" - Virat Kohli appears in RCB roster

### Test 2: Refresh and Verify Persistence
1. **Press F5** to refresh the page
2. Login again as RCB
3. **Verify**:
   - ✅ Budget still shows ₹97.5 Cr
   - ✅ Click "View My Team" - Virat Kohli still there
   - ✅ Virat Kohli **not** in available players list

### Test 3: Admin Manual Award
1. **Open Browser 3** - Login as Admin (`admin2024`)
2. From any team: Nominate "Rohit Sharma"
3. From any team: Place a bid (e.g., ₹3 Cr)
4. **From Admin Panel**:
   - Select "Chennai Super Kings" from dropdown
   - Click "Mark Player Sold"
5. **Verify**:
   - ✅ Toast shows "Rohit Sharma sold to Chennai Super Kings..."
   - ✅ CSK budget reduces
   - ✅ Rohit disappears from available list
   - ✅ Login as CSK - Rohit appears in their team

### Test 4: Excel Verification
Check the Excel file directly:
```bash
cd /Users/onayak/Desktop/ipl-app
open data/auction_data.xlsx
```

**Sold Players sheet** should show:
- Player Name
- Team Name
- Final Price
- RTM Used (Yes/No)

## Server Logs to Monitor
The server now logs:
- `Player [name] saved to Excel for team [team] at ₹[price] Cr` - When player is sold
- `Loaded [X] available players ([Y] sold)` - When fetching available players
- `Team state loaded from Excel` - On server startup

## Common Issues

### If players don't disappear from list:
1. Check browser console for errors
2. Check server terminal for "Player saved to Excel" log
3. Manually refresh the available players by clicking a different position filter

### If "View My Team" is empty after selling:
1. Check team ID matches (team you sold to vs team you logged in as)
2. Admin awards don't appear in admin's team (admin ID is 0)
3. Check Excel file to verify the sale was recorded

## Database Reset
To start fresh:
```bash
rm data/auction_data.xlsx
# Restart server - it will create a new file
```

