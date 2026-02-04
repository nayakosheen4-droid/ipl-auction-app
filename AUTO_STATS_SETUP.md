# 🤖 Automatic Stats Fetching Setup Guide

## Overview
Your IPL Fantasy League now features **automatic stats fetching** from real IPL matches! The system automatically:
- Detects completed IPL matches every 10 minutes
- Fetches detailed player statistics
- Calculates fantasy points using Dream11 formula
- Updates leaderboard in real-time
- Notifies all users via WebSocket

## 🚀 Quick Setup

### Step 1: Get Cricket API Key (FREE)
1. Visit [https://cricketdata.org/signup.aspx](https://cricketdata.org/signup.aspx)
2. Sign up with your email (FREE forever - 100 API calls/day)
3. Check your email for your lifetime API key
4. Copy the API key

### Step 2: Configure Environment Variable

**Local Development:**
```bash
# In your terminal or .env file
export CRICKET_API_KEY="your_api_key_here"

# Restart the server
npm start
```

**Railway Deployment:**
1. Go to your Railway project dashboard
2. Click on your service
3. Go to **Variables** tab
4. Click **+ New Variable**
5. Add:
   - **Name:** `CRICKET_API_KEY`
   - **Value:** your API key from cricketdata.org
6. Click **Add**
7. Railway will automatically redeploy with the new variable

**Render/Other Platforms:**
1. Go to your service settings
2. Find Environment Variables section
3. Add `CRICKET_API_KEY` with your API key
4. Save and redeploy

### Step 3: Verify Setup
1. Login as Admin
2. Go to Fantasy League → Admin tab
3. Check the **Auto-Stats Service** card:
   - ✅ "API Key: ✓ Configured" = All good!
   - ✗ "API Key: ✗ Not Set" = Add the environment variable
4. Click **"🔄 Fetch Now"** to test immediately

## 🎯 How It Works

### Automatic Mode (Recommended)
Once API key is configured, the system automatically:
1. **Every 10 minutes:** Checks for completed IPL matches
2. **Fetches Scorecard:** Gets detailed player statistics
3. **Matches Players:** Finds your auction players in the match
4. **Calculates Points:** Uses Dream11 formula
5. **Updates Database:** Saves to Excel automatically
6. **Broadcasts:** Notifies all users in real-time

### Manual Control (Admin Only)
From Fantasy League → Admin tab:
- **🔄 Fetch Now:** Trigger immediate stats check
- **Enable/Disable:** Toggle automatic fetching
- **Status Indicator:** See if service is running

## 📊 What Gets Fetched

The Cricket API provides complete player stats:

### Batting Stats
- Runs scored
- Balls faced
- Fours hit
- Sixes hit
- Strike rate

### Bowling Stats
- Wickets taken
- Overs bowled
- Runs conceded
- Maiden overs
- Economy rate

### Fielding Stats
- Catches
- Stumpings (WK)
- Run outs

All stats are automatically fed into the Dream11 scoring formula!

## 🔄 Real-Time Updates

**For All Users:**
- Toast notifications when stats are updated
- Automatic leaderboard refresh
- Live points appearing as matches complete

**No manual data entry needed!** Just sit back and watch the points roll in.

## 🎮 User Experience

### During IPL Match:
1. Real IPL match happens (e.g., MI vs CSK)
2. Match completes
3. Within 10 minutes, system fetches stats
4. All users see toast: "Virat Kohli (RCB): 89 pts - 65R 2W"
5. Leaderboard updates automatically
6. Teams see their total points increase

### Admin View:
- See stats fetch status
- Trigger manual fetch if needed
- View which matches were processed
- Console logs show detailed processing info

## 🛠️ Troubleshooting

### "API Key: ✗ Not Set"
**Problem:** Environment variable not configured
**Solution:** Follow Step 2 above to add `CRICKET_API_KEY`

### "No IPL matches found"
**Problem:** IPL season not active or no matches today
**Solution:** This is normal! System will automatically detect when IPL starts

### "Stats not updating"
**Possible Causes:**
1. API key not set → Check environment variables
2. API limit reached (100/day) → Wait 24 hours or upgrade
3. Match not marked as "completed" yet → Wait, check every 10 min
4. Player names don't match → System uses fuzzy matching, should work

**Debug Steps:**
1. Login as Admin
2. Click "🔄 Fetch Now"
3. Open browser console (F12)
4. Look for logs showing match processing
5. Check server logs for detailed info

### Match processed but player missing:
**Cause:** Player name mismatch between API and your database
**Solution:** System uses smart matching (e.g., "V Kohli" matches "Virat Kohli")
If still failing, check server logs for the exact API name

## 📈 API Limits & Costs

### Free Tier (Recommended for most users)
- **Cost:** FREE forever
- **Limit:** 100 API calls per day
- **Sufficient for:** ~10 match checks/day (every 10 min during matches)

### How to Optimize:
- System caches results for 5 minutes
- Only fetches completed matches
- Skips already-processed matches
- Very efficient! 100 calls = checking for ~10 matches multiple times

### If You Need More:
- Paid plans start at $5.99/month
- Unlimited API calls
- Priority support
- Visit cricketdata.org for details

## 🔐 Security

- API key stored as environment variable (secure)
- Never exposed to frontend
- Rate limiting built-in
- Cache to reduce unnecessary calls

## 🎉 Features Summary

✅ **Zero Manual Work:** Fully automatic after setup
✅ **Real-Time:** Updates appear as matches complete
✅ **Accurate:** Official cricket API data
✅ **Smart Matching:** Handles different name formats
✅ **Efficient:** Caching & deduplication
✅ **Reliable:** Retries and error handling
✅ **Transparent:** Logs and status indicators
✅ **Free Forever:** 100 calls/day is plenty

## 📱 Mobile Experience

Everything works perfectly on mobile:
- Receive real-time notifications
- See leaderboard updates
- No app required - just open in browser

## 🎯 Next Steps

1. **Get API Key:** Sign up at cricketdata.org
2. **Add to Railway:** Set environment variable
3. **Verify:** Check Admin panel shows "✓ Configured"
4. **Wait for IPL:** System auto-activates when matches start
5. **Enjoy:** Watch fantasy points roll in automatically!

## 🆘 Support

If you encounter issues:
1. Check this guide first
2. Verify API key is set correctly
3. Check server logs for details
4. Test with "🔄 Fetch Now" button

---

**Your fantasy league is now fully automated! 🏆**

No more manual stat entry. Just enjoy the competition!
