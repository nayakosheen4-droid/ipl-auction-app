# 🚀 Deployment Guide

## Option 1: Railway.app (Recommended - Easiest)

### Steps:

1. **Push your code to GitHub:**
   ```bash
   # If not already on GitHub
   gh repo create ipl-auction-app --public --source=. --push
   # Or manually: Create repo on github.com and push
   ```

2. **Go to Railway.app:**
   - Visit https://railway.app
   - Click "Login" and sign in with GitHub
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `ipl-auction-app` repository
   - Railway will auto-detect Node.js and deploy!

3. **Configure Environment Variables (Optional):**
   - In Railway dashboard, go to your project
   - Click on "Variables" tab
   - Add: `ADMIN_PASSWORD=your_secure_password`

4. **Get your URL:**
   - Railway will give you a URL like: `https://ipl-auction-app-production.up.railway.app`
   - Click "Generate Domain" if not auto-generated
   - Share this link with your friends!

### ⚠️ Important Notes:
- **Free tier**: Railway gives you $5 credit/month (enough for ~500 hours)
- **Data persistence**: Excel file will persist across restarts
- **WebSocket**: Fully supported

---

## Option 2: Render.com

### Steps:

1. **Push code to GitHub** (same as above)

2. **Go to Render.com:**
   - Visit https://render.com
   - Sign up with GitHub
   - Click "New +" → "Web Service"
   - Connect your `ipl-auction-app` repo

3. **Configure:**
   - Name: `ipl-auction-app`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `node server/index.js`
   - Plan: `Free`

4. **Deploy:**
   - Click "Create Web Service"
   - Wait 2-3 minutes for deployment
   - Get your URL: `https://ipl-auction-app.onrender.com`

### ⚠️ Important Notes:
- **Free tier limitations**: Service spins down after 15 mins of inactivity (takes 30s to wake up)
- **Data persistence**: Excel file persists but service restarts after inactivity

---

## Option 3: Fly.io (More Control)

### Steps:

1. **Install Fly CLI:**
   ```bash
   # Mac
   brew install flyctl
   
   # Or use install script
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login:**
   ```bash
   flyctl auth login
   ```

3. **Launch your app:**
   ```bash
   cd /Users/onayak/Desktop/ipl-app
   flyctl launch
   ```
   - Choose app name: `ipl-auction-app`
   - Choose region closest to you
   - Don't add PostgreSQL
   - Don't deploy now

4. **Create fly.toml** (already created below)

5. **Deploy:**
   ```bash
   flyctl deploy
   ```

6. **Get URL:**
   ```bash
   flyctl status
   ```
   URL will be: `https://ipl-auction-app.fly.dev`

---

## Option 4: Quick Test with ngrok (Temporary)

**For immediate testing without deployment:**

1. **Install ngrok:**
   ```bash
   # Mac
   brew install ngrok
   
   # Or download from https://ngrok.com/download
   ```

2. **Start your local server:**
   ```bash
   cd /Users/onayak/Desktop/ipl-app
   npm start
   ```

3. **In another terminal, start ngrok:**
   ```bash
   ngrok http 3000
   ```

4. **Share the URL:**
   - ngrok will give you a URL like: `https://abc123.ngrok.io`
   - Share this with friends
   - ⚠️ This URL expires when you close ngrok

---

## 📝 Pre-Deployment Checklist

- ✅ All code committed to git
- ✅ Excel file in `.gitignore` (will be created on first run)
- ✅ Environment variables configured
- ✅ Test locally: `npm start`
- ✅ GitHub repository created

---

## 🔒 Security Tips

1. **Change default passwords** in production:
   - Set `ADMIN_PASSWORD` environment variable
   - Change team passwords in `server/index.js`

2. **Add authentication improvements** (optional):
   - Use JWT tokens
   - Add session management
   - Rate limiting

3. **Backup your Excel file:**
   - Download from deployed server periodically
   - Or use a database like MongoDB/PostgreSQL

---

## 🐛 Troubleshooting

### App won't start:
- Check logs in hosting platform dashboard
- Verify `package.json` has all dependencies
- Test locally first

### WebSocket not connecting:
- Most platforms auto-support WebSocket
- Check if HTTPS is enabled
- Railway/Render handle this automatically

### Excel file not persisting:
- Railway: Has persistent storage by default
- Render (free): Restarts clear files - upgrade or use database
- Fly.io: Add volume for persistence

---

## 💰 Cost Estimates

| Platform | Free Tier | Paid |
|----------|-----------|------|
| Railway | $5/month credit (~500 hrs) | $5+/month |
| Render | Always-on with delays | $7/month for 24/7 |
| Fly.io | 3 VMs free | $1.94/month per VM |
| ngrok | Limited sessions | $8/month |

**Recommendation**: Start with **Railway** for easiest deployment with good free tier!

