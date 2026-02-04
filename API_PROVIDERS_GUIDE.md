# 🌐 Cricket API Providers Guide

## Overview
Your fantasy league now supports **multiple cricket API providers**! Choose the one that works best for you.

---

## 🏆 Recommended: RapidAPI Cricbuzz

### Why RapidAPI Cricbuzz?
✅ **More Reliable** - 100% uptime, fast servers
✅ **Better Performance** - 159ms average latency
✅ **More Features** - Comprehensive cricket data
✅ **FREE Tier Available** - $0/month basic plan
✅ **Active Maintenance** - Regularly updated
✅ **Better Documentation** - Clear API docs

### Pricing
- **BASIC (FREE)**: $0.00/month - Perfect for single league
- **PRO**: $9.99/month - Multiple leagues
- **ULTRA**: $29.99/month - High volume
- **MEGA**: $279.99/month - Enterprise

### Setup RapidAPI Cricbuzz (Recommended)

#### Step 1: Sign Up
1. Go to [rapidapi.com](https://rapidapi.com)
2. Sign up for a FREE account
3. Search for "Cricbuzz Cricket"
4. Or visit: [rapidapi.com/cricketapilive/api/cricbuzz-cricket](https://rapidapi.com/cricketapilive/api/cricbuzz-cricket)

#### Step 2: Subscribe to FREE Plan
1. Click **"Subscribe to Test"**
2. Select **"Basic"** plan ($0.00/month)
3. Add payment method (required but won't be charged)
4. Click **"Subscribe"**

#### Step 3: Get API Key
1. Go to **"Endpoints"** tab
2. Click **"Code Snippets"**
3. Copy your **X-RapidAPI-Key** value

#### Step 4: Configure Your App

**For Railway:**
```
1. Go to your Railway project
2. Click "Variables" tab
3. Add TWO variables:
   - RAPIDAPI_KEY = your_rapidapi_key_here
   - CRICKET_API_PROVIDER = rapidapi
4. Save (auto-redeploys)
```

**For Local Development:**
```bash
export RAPIDAPI_KEY="your_rapidapi_key_here"
export CRICKET_API_PROVIDER="rapidapi"
npm start
```

**In .env file:**
```env
RAPIDAPI_KEY=your_rapidapi_key_here
CRICKET_API_PROVIDER=rapidapi
```

#### Step 5: Verify
1. Login as Admin
2. Go to Fantasy League → Admin
3. Check Auto-Stats Service card
4. Should show: "API: ✓ RapidAPI Cricbuzz"

---

## 🔄 Alternative: CricketData.org

### Why CricketData.org?
✅ Lifetime free access
✅ 100 API calls/day
✅ Simple setup
⚠️ **Slower/buggy** (as you mentioned)
⚠️ Lower reliability

### Pricing
- **FREE**: Lifetime free, 100 calls/day
- **Paid**: Starting at $5.99/month

### Setup CricketData.org

#### Step 1: Sign Up
1. Visit [cricketdata.org/signup.aspx](https://cricketdata.org/signup.aspx)
2. Sign up with your email
3. Check email for API key

#### Step 2: Configure Your App

**For Railway:**
```
1. Go to Railway Variables
2. Add TWO variables:
   - CRICKET_API_KEY = your_cricketdata_key
   - CRICKET_API_PROVIDER = cricketdata
3. Save
```

**For Local Development:**
```bash
export CRICKET_API_KEY="your_cricketdata_key"
export CRICKET_API_PROVIDER="cricketdata"
npm start
```

#### Step 3: Verify
Should show: "API: ✓ CricketData.org"

---

## 📊 API Comparison

| Feature | RapidAPI Cricbuzz | CricketData.org |
|---------|------------------|-----------------|
| **Reliability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Speed** | 159ms avg | Variable |
| **Uptime** | 100% SLA | ~95% |
| **Free Tier** | Yes ($0/mo) | Yes (100/day) |
| **Data Quality** | Excellent | Good |
| **Documentation** | Excellent | Basic |
| **Support** | Active | Limited |
| **Recommendation** | ✅ **BEST** | Backup |

---

## 🔄 Switching Providers

You can easily switch between providers:

### Switch to RapidAPI Cricbuzz:
```bash
# Railway Variables
RAPIDAPI_KEY=your_key
CRICKET_API_PROVIDER=rapidapi
```

### Switch to CricketData.org:
```bash
# Railway Variables
CRICKET_API_KEY=your_key
CRICKET_API_PROVIDER=cricketdata
```

### No Code Changes Needed!
The system automatically adapts to the selected provider.

---

## 🚀 Quick Start (Recommended Path)

**For Best Experience:**

1. **Sign up for RapidAPI** (5 minutes)
   - Visit rapidapi.com
   - Create free account
   - Subscribe to Cricbuzz Cricket (FREE plan)

2. **Get Your API Key**
   - Copy X-RapidAPI-Key from dashboard

3. **Add to Railway**
   ```
   RAPIDAPI_KEY=your_key_here
   CRICKET_API_PROVIDER=rapidapi
   ```

4. **Done!** 
   - Railway auto-redeploys
   - System uses RapidAPI Cricbuzz
   - Enjoy fast, reliable stats fetching

---

## 🆓 Free Tier Comparison

### RapidAPI Cricbuzz (FREE)
- **API Calls**: Not explicitly limited on basic
- **Rate Limit**: Generous
- **Features**: Full access to endpoints
- **Best For**: Single fantasy league (perfect!)

### CricketData.org (FREE)
- **API Calls**: 100/day
- **Rate Limit**: Standard
- **Features**: Basic access
- **Best For**: Testing/backup

**Recommendation:** Start with RapidAPI for better reliability!

---

## 🛠️ Troubleshooting

### "API: ✗ Not Set"
**Check:**
1. Environment variable name matches provider
2. `RAPIDAPI_KEY` for RapidAPI
3. `CRICKET_API_KEY` for CricketData
4. `CRICKET_API_PROVIDER` set correctly

### "Stats not fetching"
**Try:**
1. Verify API key is valid
2. Check API dashboard for quota
3. Try switching providers temporarily
4. Check server logs for detailed errors

### "Provider not working"
**Solution:**
Switch to alternative provider:
```bash
# If RapidAPI not working, use CricketData
CRICKET_API_PROVIDER=cricketdata
CRICKET_API_KEY=your_backup_key

# If CricketData not working, use RapidAPI
CRICKET_API_PROVIDER=rapidapi
RAPIDAPI_KEY=your_rapidapi_key
```

---

## 📈 Which Provider Should I Use?

### Use **RapidAPI Cricbuzz** if:
✅ You want best reliability
✅ You want fast performance
✅ You're okay signing up for RapidAPI
✅ You want professional-grade API
✅ **This is the RECOMMENDED option**

### Use **CricketData.org** if:
✅ You prefer simpler signup
✅ You're okay with occasional issues
✅ You want truly lifetime free
✅ You need backup option

---

## 💡 Pro Tips

1. **Set up BOTH providers** as backup
   ```bash
   RAPIDAPI_KEY=your_rapidapi_key
   CRICKET_API_KEY=your_cricketdata_key
   CRICKET_API_PROVIDER=rapidapi  # Primary
   ```

2. **Monitor your usage** on provider dashboards

3. **Free tier is enough** for typical fantasy league (1 season, 60+ matches)

4. **Switch providers** anytime without code changes

---

## 🎯 Example Setup (Railway)

**Recommended Configuration:**
```
Environment Variables:
├── RAPIDAPI_KEY = abc123...xyz
├── CRICKET_API_PROVIDER = rapidapi
└── CRICKET_API_KEY = backup123... (optional backup)
```

**Alternative Configuration:**
```
Environment Variables:
├── CRICKET_API_KEY = xyz789...abc
├── CRICKET_API_PROVIDER = cricketdata
└── RAPIDAPI_KEY = backup456... (optional backup)
```

---

## 🔒 Security Notes

- ✅ API keys stored in environment variables (secure)
- ✅ Never commit keys to Git
- ✅ Different keys for dev/production
- ✅ Rotate keys if exposed
- ✅ Monitor usage for unusual activity

---

## 📞 Getting Help

### RapidAPI Support:
- Dashboard: rapidapi.com/dashboard
- Docs: rapidapi.com/cricketapilive/api/cricbuzz-cricket
- Support: support@rapidapi.com

### CricketData Support:
- Dashboard: cricketdata.org/member.aspx
- Email: contact@cricketdata.org

### App Issues:
- Check server logs
- Verify API key in Admin panel
- Test with "🔄 Fetch Now" button

---

## ✅ Checklist for Setup

**RapidAPI Cricbuzz (Recommended):**
- [ ] Sign up at rapidapi.com
- [ ] Subscribe to Cricbuzz Cricket (FREE plan)
- [ ] Copy X-RapidAPI-Key
- [ ] Add RAPIDAPI_KEY to Railway/environment
- [ ] Set CRICKET_API_PROVIDER=rapidapi
- [ ] Verify in Admin panel
- [ ] Test with "Fetch Now"

**CricketData.org (Alternative):**
- [ ] Sign up at cricketdata.org
- [ ] Check email for API key
- [ ] Add CRICKET_API_KEY to Railway/environment
- [ ] Set CRICKET_API_PROVIDER=cricketdata
- [ ] Verify in Admin panel
- [ ] Test with "Fetch Now"

---

**🎉 With RapidAPI Cricbuzz, you'll have fast, reliable stats fetching for your entire IPL season!**

**No more slow/buggy API issues!** 🚀
